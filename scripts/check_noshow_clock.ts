import pool from "../src/config/database";
async function main() {
  const { rows: nowRows } = await pool.query(`SELECT NOW() as db_now`);
  console.log("DB NOW():", nowRows[0].db_now);
  console.log("Node's own Date.now():", new Date().toISOString());

  const { rows } = await pool.query(
    `SELECT id, scheduled_at, ends_at, status
     FROM appointments
     WHERE status = 'booked' AND deleted_at IS NULL
     ORDER BY ends_at DESC LIMIT 10`
  );
  console.log("Recent 'booked' appointments:", JSON.stringify(rows, null, 2));

  const { rows: eligible } = await pool.query(
    `SELECT COUNT(*) as cnt FROM appointments WHERE status='booked' AND ends_at < NOW() AND deleted_at IS NULL`
  );
  console.log("Appointments eligible for no-show flip right now:", eligible[0].cnt);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
