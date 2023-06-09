import { Auth } from "convex/server";
import { DataModel, Id } from "./_generated/dataModel";
import { RowLevelSecurity } from "./rowLevelSecurity";

export const { withMutationRLS, withQueryRLS } = RowLevelSecurity<
  { auth: Auth },
  DataModel
>({
  messages: {
    read: async ({ auth }, message) => {
      // Logged-in users can read everything.
      // In logged-out state you can read anything published.
      const identity = await auth.getUserIdentity();
      if (identity === null) {
        return message.published;
      }
      return true;
    },
    write: async ({ auth }, message) => {
      // Only the author can write to an existing message.
      const identity = await auth.getUserIdentity();
      if (identity === null) {
        return false;
      }
      return message.author === identity.tokenIdentifier;
    },
    insert: async ({ auth }, message) => {
      // Only the author can create a new message.
      const identity = await auth.getUserIdentity();
      if (identity === null) {
        return false;
      }
      return message.author === identity.tokenIdentifier;
    },
  },
});
