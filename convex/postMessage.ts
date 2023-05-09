import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { withRLS } from "./withRLS";

export default mutation({
  args: { body: v.string() },
  handler: withRLS(async ({ db, auth }, { body }) => {
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
