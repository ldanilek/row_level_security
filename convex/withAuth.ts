import { Auth, DocumentByInfo, Expression, FilterBuilder, GenericTableInfo, IndexRange, IndexRangeBuilder, Indexes, MutationBuilder, NamedIndex, NamedSearchIndex, OrderedQuery, PaginationOptions, PaginationResult, Query, QueryBuilder, QueryInitializer, SearchFilter, SearchFilterBuilder, SearchIndexes } from "convex/server";
import { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { DataModel, Id } from "./_generated/dataModel";
import { API } from "./_generated/api";
import { readAccessRules, writeAccessRules } from "./authRules";

type AuthPredicate<T extends GenericTableInfo> = (doc: DocumentByInfo<T>) => Promise<boolean>;

async function asyncFilter<T>(arr: T[], predicate: (d: T) => Promise<boolean>): Promise<T[]> {
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
  filter(predicate: (q: FilterBuilder<T>) => Expression<boolean>): WrapQuery<T> {
    return new WrapQuery(this.q.filter(predicate), this.p);
  }
  order(order: "asc" | "desc"): WrapQuery<T> {
    return new WrapQuery(this.q.order(order), this.p);
  }
  async paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<DocumentByInfo<T>>> {
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
      const {value, done} = await this.iterator!.next();
      if (await this.p(value)) {
        return {value, done};
      }
      if (done) {
        return {value: null, done: true};
      }
    }
  }
  return() {
    return this.iterator!.return!();
  }
}

class WrapQueryInitializer<T extends GenericTableInfo> implements QueryInitializer<T> {
  q: QueryInitializer<T>;
  p: AuthPredicate<T>;
  constructor(q: QueryInitializer<T>, p: AuthPredicate<T>) {
    this.q = q;
    this.p = p;
  }
  fullTableScan(): Query<T> {
    return new WrapQuery(this.q.fullTableScan(), this.p);
  }
  withIndex<IndexName extends keyof Indexes<T>>(indexName: IndexName, indexRange?: ((q: IndexRangeBuilder<DocumentByInfo<T>, NamedIndex<T, IndexName>, 0>) => IndexRange) | undefined): Query<T> {
    return new WrapQuery(this.q.withIndex(indexName, indexRange), this.p);
  }
  withSearchIndex<IndexName extends keyof SearchIndexes<T>>(indexName: IndexName, searchFilter: (q: SearchFilterBuilder<DocumentByInfo<T>, NamedSearchIndex<T, IndexName>>) => SearchFilter): OrderedQuery<T> {
    return new WrapQuery(this.q.withSearchIndex(indexName, searchFilter), this.p);
  }
  filter(predicate: (q: FilterBuilder<T>) => Expression<boolean>): Query<T> {
    return this.fullTableScan().filter(predicate);
  }
  order(order: "asc" | "desc"): OrderedQuery<T> {
    return this.fullTableScan().order(order);
  }
  async paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<DocumentByInfo<T>>> {
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

class WrapReader implements DatabaseReader {
  db: DatabaseReader;
  auth: Auth;

  constructor(db: DatabaseReader, auth: Auth) {
    this.db = db;
    this.auth = auth;
  }

  async predicate<T extends GenericTableInfo>(tableName: string, doc: DocumentByInfo<T>): Promise<boolean> {
    return await readAccessRules[tableName](doc, this.auth, this.db);
  }

  async get<TableName extends string>(id: Id<TableName>): Promise<any> {
    const doc = await this.db.get(id);
    if (await this.predicate(id.tableName, doc)) {
      return doc;
    }
    return null;
  }

  query<TableName extends string>(tableName: TableName): QueryInitializer<{ document: any; fieldPaths: string; indexes: {}; searchIndexes: {}; }> {
    return new WrapQueryInitializer(this.db.query(tableName), async (d) => await this.predicate(tableName, d));
  }
}

class WrapWriter implements DatabaseWriter {
  db: DatabaseWriter;
  auth: Auth;
  reader: DatabaseReader;

  async predicate<T extends GenericTableInfo>(tableName: string, doc: DocumentByInfo<T>): Promise<boolean> {
    return await writeAccessRules[tableName](doc, this.auth, this.db);
  }
  
  constructor(db: DatabaseWriter, auth: Auth) {
    this.db = db;
    this.auth = auth;
    this.reader = new WrapReader(db, auth);
  }
  async insert<TableName extends string>(table: TableName, value: { [x: string]: any; }): Promise<Id<TableName>> {
    return await this.db.insert(table, value);
  }
  async checkAuth<TableName extends string>(id: Id<TableName>) {
    const doc = await this.get(id);
    if (doc === null) {
      throw new Error("no read access or doc does not exist");
    }
    if (!await this.predicate(id.tableName, doc)) {
      throw new Error("write access not allowed");
    }
  }
  async patch<TableName extends string>(id: Id<TableName>, value: Partial<any>): Promise<void> {
    await this.checkAuth(id);
    return await this.db.patch(id, value);
  }
  async replace<TableName extends string>(id: Id<TableName>, value: { [x: string]: any; _creationTime?: any; _id?: any; }): Promise<void> {
    await this.checkAuth(id);
    return await this.db.replace(id, value);
  }
  async delete(id: Id<string>): Promise<void> {
    await this.checkAuth(id);
    return await this.db.delete(id);
  }
  get<TableName extends string>(id: Id<TableName>): Promise<any> {
    return this.reader.get(id);
  }
  query<TableName extends string>(tableName: TableName): QueryInitializer<{ document: any; fieldPaths: string; indexes: {}; searchIndexes: {}; }> {
    return this.reader.query(tableName);
  }
};

export const withQueryAuth: QueryBuilder<DataModel, "public"> =
  (f: any): any => {
  return ((ctx: any, ...args: any[]) => {
    const db = ctx.db;
    const auth = ctx.auth;
    const wrappedDb = new WrapReader(db, auth);
    ctx.db = wrappedDb;
    return f(ctx, ...args);
  });
}

export const withMutationAuth: MutationBuilder<DataModel, API, "public"> =
  (f: any): any => {
  return ((ctx: any, ...args: any[]) => {
    const db = ctx.db;
    const auth = ctx.auth;
    const wrappedDb = new WrapWriter(db, auth);
    ctx.db = wrappedDb;
    return f(ctx, ...args);
  });
}