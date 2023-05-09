
import { query } from "./_generated/server";
import { withQueryRLS } from "./withAuth";

export default query(withQueryRLS(async ({ db }) => {
  return await db.query("messages").collect();
}));
