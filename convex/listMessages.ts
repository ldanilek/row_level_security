
import { query } from "./_generated/server";
import { withRLS } from "./withAuth";

export default query(withRLS(async ({ db }) => {
  return await db.query("messages").collect();
}));
