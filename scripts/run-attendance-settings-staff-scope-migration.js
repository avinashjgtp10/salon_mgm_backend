// One-off runner for Migration/add_attendance_settings_staff_scope.sql against
// the DB, using the backend's own env/config. Safe to re-run: the migration's
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent.
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
      `SELECT to_regclass('public.attendance_settings') AS exists`
    );
    if (!tableCheck.rows[0].exists) {
      console.error("attendance_settings table does not exist yet. Aborting.");
      process.exitCode = 1;
      return;
    }

    const sql = fs.readFileSync(
      path.join(__dirname, "../Migration/add_attendance_settings_staff_scope.sql"),
      "utf8"
    );
    await client.query(sql);

    const { rows } = await client.query(
      `SELECT column_name, data_type, column_default
       FROM information_schema.columns
       WHERE table_name = 'attendance_settings'
         AND column_name IN ('half_day_deduction_amount', 'staff_scope', 'selected_staff_ids')
       ORDER BY column_name`
    );
    console.log("attendance_settings columns now present:");
    for (const r of rows) console.log(`  - ${r.column_name}  (${r.data_type}, default ${r.column_default})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
});
