import { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { withMutationRLS } from "./withAuth";

export default mutation(withMutationRLS(async ({ db },
  { messageId, body, published }: {messageId: Id<"messages">, body: string, published: boolean},
) => {
  await db.patch(messageId, {
    body,
    published,
  });
}));
