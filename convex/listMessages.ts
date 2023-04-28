
import { query } from "./_generated/server";
import { withQueryAuth } from "./withAuth";

export default withQueryAuth(async ({ db }) => {
  return await db.query("messages").collect();
});
