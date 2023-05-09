import { QueryCtx, query } from "./_generated/server";
import { withQueryRLS } from "./withRLS";

export default query(withQueryRLS(async ({ db }) => {
    return await db.query("messages").collect();
  }),
);
