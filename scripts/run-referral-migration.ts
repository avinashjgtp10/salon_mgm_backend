/**
 * One-time migration runner — adds Refer & Earn columns to the clients table.
 * Run with:  npx ts-node scripts/run-referral-migration.ts
 */
import pool from '../src/config/database';

const migrations: { name: string; sql: string }[] = [
  {
    name: 'add referral_code to clients',
    sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);`,
  },
  {
    name: 'add referral_reward_status to clients',
    sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_reward_status VARCHAR(20) CHECK (referral_reward_status IN ('pending', 'completed'));`,
  },
  {
    name: 'unique index on (salon_id, referral_code)',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_referral_code_per_salon ON clients (salon_id, referral_code) WHERE referral_code IS NOT NULL;`,
  },
  {
    name: 'index on referred_by_client_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_clients_referred_by ON clients (referred_by_client_id);`,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      process.stdout.write(`Running: ${m.name} ... `);
      await client.query(m.sql);
      console.log('OK');
    }
    console.log('\n✅ All referral migrations applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
