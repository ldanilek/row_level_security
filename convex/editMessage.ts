import { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { withMutationAuth } from "./withAuth";

export default withMutationAuth(async ({ db },
  { messageId, body, published }: {messageId: Id<"messages">, body: string, published: boolean},
) => {
  await db.patch(messageId, {
    body,
    published,
  });
});
