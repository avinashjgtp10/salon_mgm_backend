/**
 * One-time migration runner — adds batch grouping columns to the coupons table
 * so bulk-created coupons can be collapsed into one row in the UI.
 * Run with:  npx ts-node scripts/run-coupons-batch-migration.ts
 */
import pool from '../src/config/database';

const migrations: { name: string; sql: string }[] = [
  { name: 'add batch_id to coupons', sql: `ALTER TABLE coupons ADD COLUMN IF NOT EXISTS batch_id UUID;` },
  { name: 'add batch_label to coupons', sql: `ALTER TABLE coupons ADD COLUMN IF NOT EXISTS batch_label VARCHAR(20);` },
  { name: 'index on (salon_id, batch_id)', sql: `CREATE INDEX IF NOT EXISTS idx_coupons_batch_id ON coupons (salon_id, batch_id) WHERE batch_id IS NOT NULL;` },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      process.stdout.write(`Running: ${m.name} ... `);
      await client.query(m.sql);
      console.log('OK');
    }
    console.log('\n✅ Coupons batch-field migrations applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
