import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { withRLS } from "./withRLS";

export default mutation({
  args: {
    messageId: v.id("messages"),
    body: v.string(),
    published: v.boolean(),
  },
  handler: withRLS(async ({ db }, { messageId, body, published }) => {
    await db.patch(messageId, {
      body,
      published,
    });
  }),
});
