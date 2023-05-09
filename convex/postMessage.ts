import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { withMutationRLS } from "./withRLS";

export default mutation({
  args: { body: v.string() },
  handler: withMutationRLS(async ({ db, auth }, { body }) => {
    const identity = await auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Unauthenticated call to mutation");
    }
    await db.insert("messages", {
      body,
      author: identity.tokenIdentifier,
      published: false,
    });
  }),
});
