import {
  DatabaseReader,
  DatabaseWriter,
  DocumentByInfo,
  DocumentByName,
  Expression,
  FilterBuilder,
  FunctionArgs,
  GenericDataModel,
  GenericTableInfo,
  IndexRange,
  IndexRangeBuilder,
  Indexes,
  NamedIndex,
  NamedSearchIndex,
  NamedTableInfo,
  OrderedQuery,
  PaginationOptions,
  PaginationResult,
  Query,
  QueryInitializer,
  SearchFilter,
  SearchFilterBuilder,
  SearchIndexes,
  TableNamesInDataModel,
  UnvalidatedFunction,
} from "convex/server";
import { GenericId } from "convex/values";

export type Rule<
  Ctx,
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>
> = (
  ctx: Ctx,
  message: DocumentByName<DataModel, TableName>
) => Promise<boolean>;

export type Rules<Ctx, DataModel extends GenericDataModel> = {
  [T in TableNamesInDataModel<DataModel>]?: Rule<Ctx, DataModel, T>;
};

/**
 * Apply row level security (RLS) to queries and mutations with the returned
 * middleware functions.
 *
 * Example:
 * ```
 * // Defined in a common file so it can be used by all queries and mutations.
 * const { withMutationRLS } = RowLevelSecurity<{auth: Auth, db: DatabaseReader}, DataModel>(
 *  {
 *    cookies: ({auth}, cookie) => !cookie.eaten,
 *  },
 *  {
 *    cookies: async ({auth, db}, cookie) => {
 *      const user = await getUser(auth, db);
 *      return user.isParent;  // only parents can reach the cookies.
 *    }
 *  }
 * );
 * // Mutation with row level security enabled.
 * export const eatCookie = mutation(withMutationRLS(
 *  async ({db}, {cookieId}: {cookieId: Id<"cookie">}) => {
 *   // throws "does not exist" error if cookie is already eaten or doesn't exist.
 *   // throws "write access" error if authorized user is not a parent.
 *   await db.patch(cookieId, {eaten: true});
 * }));
 * ```
 *
 * Notes:
 * * Rules may read any row in `db` -- rules do not apply recursively within the
 *   rule functions themselves.
 * * Tables with no rule default to full access.
 * * Middleware functions like `withUser` can be composed with RowLevelSecurity
 *   to cache fetches in `ctx`. e.g.
 * ```
 * const { withQueryRLS } = RowLevelSecurity<{user: Doc<"users">}, DataModel>(
 *  {
 *    cookies: ({user}, cookie) => user.isParent,
 *  }
 * );
 * export default query(withUser(withQueryRLS(...)));
 * ```
 *
 * @param readAccessRules - rule for each table, determining whether a row
 *  should be visible.
 * @param writeAccessRules - rule for each table, determining whether a row
 *  may be written by `patch`, `replace`, or `delete`.
 *  Rules do not restrict `db.insert`.
 *  If `writeAccessRules` are omitted, write access is only restricted by read
 *  access rules.
 *
 * @returns Functions `withQueryRLS` and `withMutationRLS`, to be passed to
 *  `query` and `mutation` respectively. For each row read or written, the auth
 *  rules are applied.
 */
export const RowLevelSecurity = <Ctx, DataModel extends GenericDataModel>(
  readAccessRules: Rules<Ctx, DataModel>,
  writeAccessRules?: Rules<Ctx, DataModel>
) => {
  const withQueryRLS = <Ctx, Args extends [] | [FunctionArgs], Output>(
    f: UnvalidatedFunction<Ctx, Args, Output>
  ) => {
    return ((ctx: any, ...args: any[]) => {
      const db = ctx.db;
      if (!db) {
        throw new Error("ctx must contain `db` for row level security");
      }
      const wrappedDb = new WrapReader(ctx, db, readAccessRules);
      return (f as any)({ ...ctx, db: wrappedDb }, ...args);
    }) as UnvalidatedFunction<Ctx, Args, Output>;
  };
  const withMutationRLS = <Ctx, Args extends [] | [FunctionArgs], Output>(
    f: UnvalidatedFunction<Ctx, Args, Output>
  ) => {
    return ((ctx: any, ...args: any[]) => {
      const db = ctx.db;
      if (!db) {
        throw new Error("ctx must contain `db` for row level security");
      }
      const wrappedDb = new WrapWriter(
        ctx,
        db,
        readAccessRules,
        writeAccessRules || {}
      );
      return (f as any)({ ...ctx, db: wrappedDb }, ...args);
    }) as UnvalidatedFunction<Ctx, Args, Output>;
  };
  return { withQueryRLS, withMutationRLS };
};

type AuthPredicate<T extends GenericTableInfo> = (
  doc: DocumentByInfo<T>
) => Promise<boolean>;

async function asyncFilter<T>(
  arr: T[],
  predicate: (d: T) => Promise<boolean>
): Promise<T[]> {
  const results = await Promise.all(arr.map(predicate));
  return arr.filter((_v, index) => results[index]);
}

class WrapQuery<T extends GenericTableInfo> implements Query<T> {
  q: Query<T>;
  p: AuthPredicate<T>;
  iterator?: AsyncIterator<any>;
  constructor(q: Query<T> | OrderedQuery<T>, p: AuthPredicate<T>) {
    this.q = q as Query<T>;
    this.p = p;
  }
  filter(
    predicate: (q: FilterBuilder<T>) => Expression<boolean>
  ): WrapQuery<T> {
    return new WrapQuery(this.q.filter(predicate), this.p);
  }
  order(order: "asc" | "desc"): WrapQuery<T> {
    return new WrapQuery(this.q.order(order), this.p);
  }
  async paginate(
    paginationOpts: PaginationOptions
  ): Promise<PaginationResult<DocumentByInfo<T>>> {
    const result = await this.q.paginate(paginationOpts);
    result.page = await asyncFilter(result.page, this.p);
    return result;
  }
  async collect(): Promise<DocumentByInfo<T>[]> {
    const results = await this.q.collect();
    return await asyncFilter(results, this.p);
  }
  async take(n: number): Promise<DocumentByInfo<T>[]> {
    const results = [];
    for await (const result of this) {
      results.push(result);
      if (results.length >= n) {
        break;
      }
    }
    return results;
  }
  async first(): Promise<DocumentByInfo<T> | null> {
    for await (const result of this) {
      return result;
    }
    return null;
  }
  async unique(): Promise<DocumentByInfo<T> | null> {
    let uniqueResult = null;
    for await (const result of this) {
      if (uniqueResult === null) {
        uniqueResult = result;
      } else {
        throw new Error("not unique");
      }
    }
    return uniqueResult;
  }
  [Symbol.asyncIterator](): AsyncIterator<DocumentByInfo<T>, any, undefined> {
    this.iterator = this.q[Symbol.asyncIterator]();
    return this;
  }
  async next(): Promise<IteratorResult<any>> {
    for (;;) {
      const { value, done } = await this.iterator!.next();
      if (await this.p(value)) {
        return { value, done };
      }
      if (done) {
        return { value: null, done: true };
      }
    }
  }
  return() {
    return this.iterator!.return!();
  }
}

class WrapQueryInitializer<T extends GenericTableInfo>
  implements QueryInitializer<T>
{
  q: QueryInitializer<T>;
  p: AuthPredicate<T>;
  constructor(q: QueryInitializer<T>, p: AuthPredicate<T>) {
    this.q = q;
    this.p = p;
  }
  fullTableScan(): Query<T> {
    return new WrapQuery(this.q.fullTableScan(), this.p);
  }
  withIndex<IndexName extends keyof Indexes<T>>(
    indexName: IndexName,
    indexRange?:
      | ((
          q: IndexRangeBuilder<DocumentByInfo<T>, NamedIndex<T, IndexName>, 0>
        ) => IndexRange)
      | undefined
  ): Query<T> {
    return new WrapQuery(this.q.withIndex(indexName, indexRange), this.p);
  }
  withSearchIndex<IndexName extends keyof SearchIndexes<T>>(
    indexName: IndexName,
    searchFilter: (
      q: SearchFilterBuilder<DocumentByInfo<T>, NamedSearchIndex<T, IndexName>>
    ) => SearchFilter
  ): OrderedQuery<T> {
    return new WrapQuery(
      this.q.withSearchIndex(indexName, searchFilter),
      this.p
    );
  }
  filter(predicate: (q: FilterBuilder<T>) => Expression<boolean>): Query<T> {
    return this.fullTableScan().filter(predicate);
  }
  order(order: "asc" | "desc"): OrderedQuery<T> {
    return this.fullTableScan().order(order);
  }
  async paginate(
    paginationOpts: PaginationOptions
  ): Promise<PaginationResult<DocumentByInfo<T>>> {
    return this.fullTableScan().paginate(paginationOpts);
  }
  collect(): Promise<DocumentByInfo<T>[]> {
    return this.fullTableScan().collect();
  }
  take(n: number): Promise<DocumentByInfo<T>[]> {
    return this.fullTableScan().take(n);
  }
  first(): Promise<DocumentByInfo<T> | null> {
    return this.fullTableScan().first();
  }
  unique(): Promise<DocumentByInfo<T> | null> {
    return this.fullTableScan().unique();
  }
  [Symbol.asyncIterator](): AsyncIterator<DocumentByInfo<T>, any, undefined> {
    return this.fullTableScan()[Symbol.asyncIterator]();
  }
}

class WrapReader<Ctx, DataModel extends GenericDataModel>
  implements DatabaseReader<DataModel>
{
  ctx: Ctx;
  db: DatabaseReader<DataModel>;
  readAccessRules: Rules<Ctx, DataModel>;

  constructor(
    ctx: Ctx,
    db: DatabaseReader<DataModel>,
    readAccessRules: Rules<Ctx, DataModel>
  ) {
    this.ctx = ctx;
    this.db = db;
    this.readAccessRules = readAccessRules;
  }

  async predicate<T extends GenericTableInfo>(
    tableName: string,
    doc: DocumentByInfo<T>
  ): Promise<boolean> {
    if (!(tableName in this.readAccessRules)) {
      return true;
    }
    return await this.readAccessRules[tableName]!(this.ctx, doc);
  }

  async get<TableName extends string>(id: GenericId<TableName>): Promise<any> {
    const doc = await this.db.get(id);
    if (doc && (await this.predicate(id.tableName, doc))) {
      return doc;
    }
    return null;
  }

  query<TableName extends string>(
    tableName: TableName
  ): QueryInitializer<NamedTableInfo<DataModel, TableName>> {
    return new WrapQueryInitializer(
      this.db.query(tableName),
      async (d) => await this.predicate(tableName, d)
    );
  }
}

class WrapWriter<Ctx, DataModel extends GenericDataModel>
  implements DatabaseWriter<DataModel>
{
  ctx: Ctx;
  db: DatabaseWriter<DataModel>;
  reader: DatabaseReader<DataModel>;
  writeAccessRules: Rules<Ctx, DataModel>;

  async predicate<T extends GenericTableInfo>(
    tableName: string,
    doc: DocumentByInfo<T>
  ): Promise<boolean> {
    if (!(tableName in this.writeAccessRules)) {
      return true;
    }
    return await this.writeAccessRules[tableName]!(this.ctx, doc);
  }

  constructor(
    ctx: Ctx,
    db: DatabaseWriter<DataModel>,
    readAccessRules: Rules<Ctx, DataModel>,
    writeAccessRules: Rules<Ctx, DataModel>
  ) {
    this.ctx = ctx;
    this.db = db;
    this.reader = new WrapReader(ctx, db, readAccessRules);
    this.writeAccessRules = writeAccessRules;
  }
  async insert<TableName extends string>(
    table: TableName,
    value: any
  ): Promise<any> {
    // No auth check on insert.
    return await this.db.insert(table, value);
  }
  async checkAuth<TableName extends string>(id: GenericId<TableName>) {
    const doc = await this.get(id);
    if (doc === null) {
      throw new Error("no read access or doc does not exist");
    }
    if (!(await this.predicate(id.tableName, doc))) {
      throw new Error("write access not allowed");
    }
  }
  async patch<TableName extends string>(
    id: GenericId<TableName>,
    value: Partial<any>
  ): Promise<void> {
    await this.checkAuth(id);
    return await this.db.patch(id, value);
  }
  async replace<TableName extends string>(
    id: GenericId<TableName>,
    value: any
  ): Promise<void> {
    await this.checkAuth(id);
    return await this.db.replace(id, value);
  }
  async delete(id: GenericId<string>): Promise<void> {
    await this.checkAuth(id);
    return await this.db.delete(id);
  }
  get<TableName extends string>(id: GenericId<TableName>): Promise<any> {
    return this.reader.get(id);
  }
  query<TableName extends string>(tableName: TableName): QueryInitializer<any> {
    return this.reader.query(tableName);
  }
}
