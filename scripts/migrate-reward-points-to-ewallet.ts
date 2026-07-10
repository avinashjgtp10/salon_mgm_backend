/**
 * One-time migration — converts every client's existing reward_points_balance
 * into an equivalent ₹ credit in their eWallet, using their salon's currently
 * configured redeem rate, then zeroes the legacy points balance.
 *
 * Reward points no longer exist as a separate redeemable balance (see
 * payments.service.ts) — new earnings are credited straight into eWallet.
 * This script carries forward whatever existing clients had already earned
 * so nobody loses value in the transition.
 *
 * Run with:  npx ts-node scripts/migrate-reward-points-to-ewallet.ts
 */
import pool from '../src/config/database';
import { rewardPointsRepository } from '../src/modules/reward-points/reward-points.repository';
import { ewalletRepository } from '../src/modules/ewallet/ewallet.repository';
import type { RewardPointsConfig } from '../src/modules/reward-points/reward-points.types';

async function run() {
  const { rows: clients } = await pool.query(
    `SELECT id, salon_id, reward_points_balance FROM clients WHERE reward_points_balance > 0`
  );
  console.log(`Found ${clients.length} client(s) with a reward points balance to migrate.\n`);

  const configCache = new Map<string, RewardPointsConfig>();
  let migrated = 0;
  let skipped = 0;

  for (const c of clients) {
    let config = configCache.get(c.salon_id);
    if (!config) {
      config = await rewardPointsRepository.getConfig(c.salon_id);
      configCache.set(c.salon_id, config);
    }

    const points = Number(c.reward_points_balance) || 0;
    if (config.redeem_points <= 0 || points <= 0) {
      skipped += 1;
      continue;
    }

    const value = (points / config.redeem_points) * config.redeem_value;
    if (value <= 0) {
      skipped += 1;
      continue;
    }

    await ewalletRepository.applyLedgerEntry({
      clientId: c.id,
      salonId: c.salon_id,
      type: 'topup',
      delta: value,
      sourceType: 'reward_migration',
      note: `One-time migration of ${points} legacy reward points`,
    });
    await pool.query(`UPDATE clients SET reward_points_balance = 0 WHERE id = $1`, [c.id]);

    migrated += 1;
    console.log(`Migrated client ${c.id}: ${points} pts → ₹${value.toFixed(2)}`);
  }

  console.log(`\n✅ Migrated ${migrated} client(s), skipped ${skipped} (no valid conversion rate).`);
  await pool.end();
}

run().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
