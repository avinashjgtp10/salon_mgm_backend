/**
 * Verifies: referral earn/redeem and reward-points earn/redeem now use their
 * own dedicated balances, and NEVER touch clients.ewallet_balance anymore.
 * Run with: npx ts-node scripts/verify-ewallet-reward-referral-split.ts
 */
import pool from "../src/config/database";
import { referralRepository } from "../src/modules/referral/referral.repository";
import { rewardPointsRepository } from "../src/modules/reward-points/reward-points.repository";

const CLIENT_ID = "070c0147-9626-40eb-afa1-9a10584fd3c7";
const SALON_ID = "64e84fd5-fcfc-44cd-b826-8802705965bf";

let failures = 0;
function check(label: string, cond: boolean, detail: string) {
  if (cond) console.log(`OK: ${label}`);
  else { console.error(`FAIL: ${label} — ${detail}`); failures++; }
}

async function getEwalletBalance(): Promise<number> {
  const { rows } = await pool.query(`SELECT ewallet_balance FROM clients WHERE id = $1`, [CLIENT_ID]);
  return Number(rows[0]?.ewallet_balance) || 0;
}

async function run() {
  const ewalletBefore = await getEwalletBalance();
  const referralBefore = await referralRepository.getBalance(CLIENT_ID);
  const rewardBefore = await rewardPointsRepository.getBalance(CLIENT_ID);

  // ── Referral earn ──────────────────────────────────────────────────────
  const referralAfterEarn = await referralRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "earn", delta: 500,
    sourceType: "referral_welcome", note: "VERIFY-SPLIT test",
  });
  check("referral earn: balance increments correctly", referralAfterEarn === referralBefore + 500, `expected ${referralBefore + 500}, got ${referralAfterEarn}`);
  const ewalletAfterReferralEarn = await getEwalletBalance();
  check("referral earn: ewallet_balance untouched", ewalletAfterReferralEarn === ewalletBefore, `before=${ewalletBefore} after=${ewalletAfterReferralEarn}`);

  // ── Reward points earn ─────────────────────────────────────────────────
  const rewardAfterEarn = await rewardPointsRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "earn", delta: 250,
    sourceType: "payment", note: "VERIFY-SPLIT test",
  });
  check("reward earn: balance increments correctly (raw points)", rewardAfterEarn === rewardBefore + 250, `expected ${rewardBefore + 250}, got ${rewardAfterEarn}`);
  const ewalletAfterRewardEarn = await getEwalletBalance();
  check("reward earn: ewallet_balance untouched", ewalletAfterRewardEarn === ewalletBefore, `before=${ewalletBefore} after=${ewalletAfterRewardEarn}`);

  // ── Referral redeem ─────────────────────────────────────────────────────
  const referralAfterRedeem = await referralRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "redeem", delta: -200,
    sourceType: "payment", note: "VERIFY-SPLIT test redeem",
  });
  check("referral redeem: balance decrements correctly", referralAfterRedeem === referralAfterEarn - 200, `expected ${referralAfterEarn - 200}, got ${referralAfterRedeem}`);

  // ── Reward points redeem ────────────────────────────────────────────────
  const rewardAfterRedeem = await rewardPointsRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "redeem", delta: -100,
    sourceType: "payment", note: "VERIFY-SPLIT test redeem",
  });
  check("reward redeem: balance decrements correctly", rewardAfterRedeem === rewardAfterEarn - 100, `expected ${rewardAfterEarn - 100}, got ${rewardAfterRedeem}`);

  const ewalletFinal = await getEwalletBalance();
  check("final: ewallet_balance completely untouched throughout", ewalletFinal === ewalletBefore, `before=${ewalletBefore} final=${ewalletFinal}`);

  // ── Cleanup: restore both balances to their original values ────────────
  await referralRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "adjust", delta: referralBefore - referralAfterRedeem,
    sourceType: "cleanup", note: "VERIFY-SPLIT cleanup — restore original balance",
  });
  await rewardPointsRepository.applyLedgerEntry({
    clientId: CLIENT_ID, salonId: SALON_ID, type: "adjust", delta: rewardBefore - rewardAfterRedeem,
    sourceType: "cleanup", note: "VERIFY-SPLIT cleanup — restore original balance",
  });
  await pool.query(`DELETE FROM referral_ledger WHERE client_id = $1 AND note LIKE 'VERIFY-SPLIT%'`, [CLIENT_ID]);
  await pool.query(`DELETE FROM reward_points_ledger WHERE client_id = $1 AND note LIKE 'VERIFY-SPLIT%'`, [CLIENT_ID]);
  console.log("Cleaned up test ledger entries and restored balances.");

  console.log(failures === 0 ? "\n✅ All checks passed" : `\n❌ ${failures} check(s) failed`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => { console.error("Script crashed:", err); process.exit(1); });
