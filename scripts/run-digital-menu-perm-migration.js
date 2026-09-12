// One-off runner for Migration/add_digital_menu_permission_keys.sql against
// the dev DB, using the backend's own env/config. Safe to re-run: the
// migration's INSERT uses ON CONFLICT (key) DO NOTHING.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const sslConfig = (() => {
  if (process.env.DB_SSL !== "true") return false;
  return { rejectUnauthorized: false };
})();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig,
});

async function main() {
  const client = await pool.connect();
  try {
    const tableCheck = await client.query(
      `SELECT to_regclass('public.permissions') AS exists`
    );
    if (!tableCheck.rows[0].exists) {
      console.error("permissions table does not exist yet — create_permissions_system_tables.sql must be applied first. Aborting.");
      process.exitCode = 1;
      return;
    }

    const sql = fs.readFileSync(
      path.join(__dirname, "../Migration/add_digital_menu_permission_keys.sql"),
      "utf8"
    );
    await client.query(sql);

    const { rows } = await client.query(
      `SELECT key, name FROM permissions WHERE module = 'Catalog' AND group_name = 'Digital Menu' ORDER BY key`
    );
    console.log("Digital Menu permission keys now in the catalog:");
    for (const r of rows) console.log(`  - ${r.key}  (${r.name})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
});
