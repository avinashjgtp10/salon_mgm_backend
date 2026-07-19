/**
 * One-time migration runner — unifies appointments.status (native Postgres
 * ENUM appointment_status) onto the new 6-value vocabulary:
 * booked | paid | partial | cancelled | no-show | deleted.
 *
 * IMPORTANT: the 4 `ALTER TYPE ... ADD VALUE` statements MUST run as separate
 * client.query() calls (not batched into one multi-statement string, and NOT
 * wrapped in an explicit BEGIN/COMMIT) so each auto-commits before the UPDATE
 * runs — Postgres forbids using a brand-new enum value inside the same
 * transaction that added it.
 *
 * Run with:  npx ts-node scripts/run-unify-appointment-status-migration.ts
 */
import pool from '../src/config/database';

const migrations: { name: string; sql: string }[] = [
  { name: "add enum value 'paid'",     sql: `ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'paid';` },
  { name: "add enum value 'partial'",  sql: `ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'partial';` },
  { name: "add enum value 'no-show'",  sql: `ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'no-show';` },
  { name: "add enum value 'deleted'",  sql: `ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'deleted';` },
  {
    name: 'backfill unified status',
    sql: `
      UPDATE appointments a SET status = (CASE
        WHEN a.deleted_at IS NOT NULL THEN 'deleted'
        WHEN a.status = 'cancelled' THEN 'cancelled'
        WHEN a.status = 'no_show' THEN 'no-show'
        WHEN a.status = 'completed' THEN 'paid'
        WHEN EXISTS (
          SELECT 1 FROM payments p WHERE p.appointment_id = a.id
            AND p.status IN ('completed', 'partial')
            AND COALESCE(p.due_amount, 0) = 0
        ) THEN 'paid'
        WHEN EXISTS (
          SELECT 1 FROM payments p WHERE p.appointment_id = a.id
            AND p.status IN ('completed', 'partial')
        ) THEN 'partial'
        ELSE 'booked'
      END)::appointment_status;
    `,
  },
  { name: 'drop payment_status column',     sql: `ALTER TABLE appointments DROP COLUMN IF EXISTS payment_status;` },
  { name: 'drop service_started_at column', sql: `ALTER TABLE appointments DROP COLUMN IF EXISTS service_started_at;` },
  { name: 'drop service_ended_at column',   sql: `ALTER TABLE appointments DROP COLUMN IF EXISTS service_ended_at;` },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      process.stdout.write(`Running: ${m.name} ... `);
      await client.query(m.sql);
      console.log('OK');
    }
    console.log('\n✅ Appointment status unification migration applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
