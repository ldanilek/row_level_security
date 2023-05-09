import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { MutationCtx, mutation } from "./_generated/server";
import { withMutationRLS } from "./withRLS";

export default mutation(
  withMutationRLS(
    async (
      { db },
      {
        messageId,
        body,
        published,
      }: { messageId: Id<"messages">; body: string; published: boolean }
    ) => {
      await db.patch(messageId, {
        body,
        published,
      });
    }
  )
);
