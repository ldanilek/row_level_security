import { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { withRLS } from "./withRLS";

export default mutation(
  withRLS(
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
