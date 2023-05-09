import { query } from "./_generated/server";
import { withRLS } from "./withRLS";

export default query({
  args: {},
  handler: withRLS(async ({ db }) => {
    return await db.query("messages").collect();
  }),
});
