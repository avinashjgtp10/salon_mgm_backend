/**
 * One-time migration runner — adds discount/charges/tip/gst columns to appointments.
 * Run with:  npx ts-node scripts/run-appointment-charges-migration.ts
 */
import pool from '../src/config/database';

const sql = `
  ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage'
      CHECK (discount_type IN ('percentage', 'flat')),
    ADD COLUMN IF NOT EXISTS ex_charges NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
`;

async function run() {
  const client = await pool.connect();
  try {
    process.stdout.write('Running: add discount/charges/tip/gst to appointments ... ');
    await client.query(sql);
    console.log('OK');
    console.log('\n✅ Migration applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
