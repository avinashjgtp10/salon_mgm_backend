/**
 * One-time migration runner — adds referral_referee_rewarded to clients so
 * the referred client's own welcome reward can be tracked independently of
 * the referrer's payout status (referral_reward_status).
 * Run with:  npx ts-node scripts/run-referee-reward-migration.ts
 */
import pool from '../src/config/database';

const migrations: { name: string; sql: string }[] = [
  { name: 'add referral_referee_rewarded to clients', sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_referee_rewarded BOOLEAN NOT NULL DEFAULT FALSE;` },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      process.stdout.write(`Running: ${m.name} ... `);
      await client.query(m.sql);
      console.log('OK');
    }
    console.log('\n✅ Referee reward-status migration applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
