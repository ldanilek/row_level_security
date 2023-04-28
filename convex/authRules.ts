import { Auth } from "convex/server";
import { Doc } from "./_generated/dataModel";
import { DatabaseReader } from "./_generated/server";

type Rule = (message: Doc, auth: Auth, db: DatabaseReader) => Promise<boolean>;

// Logged-in users can read everything.
// In logged-out state you can read anything published.
export const readAccessRules: Record<string, Rule> = {
  messages: async (message: Doc, auth: Auth, db: DatabaseReader): Promise<boolean> => {
    const identity = await auth.getUserIdentity();
    if (identity === null) {
      return message.published;
    }
    return true;
  }
};

// Only the author can write to a message.
export const writeAccessRules: Record<string, Rule> = {
  messages: async (message: Doc, auth: Auth, db: DatabaseReader): Promise<boolean> => {
    const identity = await auth.getUserIdentity();
    if (identity === null) {
      return false;
    }
    return message.author === identity.tokenIdentifier;
  }
};
