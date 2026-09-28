import pool from "./src/config/database";
import fs from "fs";
async function main() {
  const sql = fs.readFileSync("Migration/remove_view_dashboard_client_info_permission.sql", "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(sql);
    await client.query("COMMIT");
    console.log("MIGRATION_APPLIED_OK");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("MIGRATION_FAILED:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main();
