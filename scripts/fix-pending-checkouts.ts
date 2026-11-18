/**
 * One-off script: list (and optionally fix) attendance records that have
 * check_in but no check_out from previous days.
 *
 * Run:  npx ts-node scripts/fix-pending-checkouts.ts
 * Fix:  npx ts-node scripts/fix-pending-checkouts.ts --fix
 */
import pool from "../src/config/database";

const FIX = process.argv.includes("--fix");

async function main() {
  const { rows } = await pool.query<{
    id: string; staff_id: string; salon_id: string; date: string;
    check_in: string; staff_name: string;
    start_time: string | null; end_time: string | null;
  }>(`
    SELECT
      a.id, a.staff_id, a.salon_id,
      a.date::text AS date,
      to_char(a.check_in AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS check_in,
      TRIM(CONCAT(s.first_name, ' ', COALESCE(s.last_name, ''))) AS staff_name,
      ss.start_time::text, ss.end_time::text
    FROM attendance a
    JOIN staff s ON s.id = a.staff_id
    LEFT JOIN LATERAL (
      SELECT start_time, end_time FROM staff_schedules
      WHERE staff_id = a.staff_id
        AND (date = a.date OR (date IS NULL AND day_of_week = EXTRACT(DOW FROM a.date)))
      ORDER BY date NULLS LAST LIMIT 1
    ) ss ON true
    WHERE a.check_in IS NOT NULL
      AND a.check_out IS NULL
      AND a.date < CURRENT_DATE
    ORDER BY a.date ASC
    LIMIT 50
  `);

  if (!rows.length) {
    console.log("✅ No pending checkouts found.");
    await pool.end(); return;
  }

  console.log(`Found ${rows.length} pending checkout(s):\n`);
  for (const r of rows) {
    console.log(`  Staff : ${r.staff_name}`);
    console.log(`  Date  : ${r.date}   Check-in: ${r.check_in}`);
    console.log(`  Shift : ${r.start_time ?? "—"} → ${r.end_time ?? "—"}`);
    console.log(`  ID    : ${r.id}`);

    if (FIX) {
      if (!r.end_time) {
        console.log(`  ⚠️  No schedule end time — skipping (manager must correct schedule first)\n`);
        continue;
      }
      // Build the checkout timestamp: date + end_time in UTC (same logic as shiftWindow)
      // Simple approach: combine date + end_time as a timestamp
      const checkoutAt = `${r.date}T${r.end_time}Z`;
      const { rowCount } = await pool.query(
        `UPDATE attendance
         SET check_out    = $2::timestamptz,
             hours_worked = EXTRACT(EPOCH FROM ($2::timestamptz - check_in)) / 3600,
             note         = concat_ws(E'\\n', NULLIF(note,''), 'Pending checkout fixed by admin script using assigned schedule end.'),
             updated_at   = NOW()
         WHERE id = $1 AND check_out IS NULL`,
        [r.id, checkoutAt]
      );
      console.log(rowCount ? `  ✅ Fixed — checkout saved at ${checkoutAt}\n` : `  ⚠️  Already checked out (skipped)\n`);
    } else {
      console.log("");
    }
  }

  if (!FIX) {
    console.log("👆 Run with --fix to apply checkouts using each staff member's scheduled shift end.");
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
