import { Auth, DocumentByInfo, Expression, FilterBuilder, FunctionArgs, GenericTableInfo, IndexRange, IndexRangeBuilder, Indexes, MutationBuilder, NamedIndex, NamedSearchIndex, OrderedQuery, PaginationOptions, PaginationResult, Query, QueryBuilder, QueryInitializer, SearchFilter, SearchFilterBuilder, SearchIndexes, UnvalidatedFunction } from "convex/server";
import { DatabaseReader, DatabaseWriter, mutation, query } from "./_generated/server";
import { DataModel, Id } from "./_generated/dataModel";
import { RowLevelSecurity } from "./rowLevelSecurity";

export const {withQueryRLS, withMutationRLS} = RowLevelSecurity<{auth: Auth}, DataModel>(
  {
    messages: async ({auth}, message) => {
      // Logged-in users can read everything.
      // In logged-out state you can read anything published.
      const identity = await auth.getUserIdentity();
      if (identity === null) {
        return message.published;
      }
      return true;
    }
  },
  {
    messages: async ({auth}, message) => {
      // Only the author can write to a message.
      const identity = await auth.getUserIdentity();
      if (identity === null) {
        return message.published;
      }
      return true;
    }
  },
);
