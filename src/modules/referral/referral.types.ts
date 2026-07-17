// Stored as the `value` of a salon_settings row keyed "REFERRAL_CONFIG"
// (same generic key/value store as REWARD_POINTS_CONFIG — see reward-points.types.ts).
export type ReferralConfig = {
  active: boolean;
  referrer_reward_amount: number; // ₹ credited to the referrer's wallet
  referee_reward_amount: number;  // ₹ credited to the new/referred customer's wallet
  min_bill_amount: number;        // referred customer's first paid bill must be ≥ this to unlock rewards
  max_wallet_usage_pct: number;   // max % of a bill that can be paid using wallet balance
};

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  active: false,
  referrer_reward_amount: 100,
  referee_reward_amount: 50,
  min_bill_amount: 1000,
  max_wallet_usage_pct: 100,
};

export type ReferralLedgerType = 'earn' | 'redeem' | 'adjust';

export type ReferralLedgerEntry = {
  id: string;
  client_id: string;
  salon_id: string;
  type: ReferralLedgerType;
  amount: number;
  balance_after: number;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_at: string;
};

// first 3 letters of the customer's name (uppercase) + hour (12-hour clock,
// zero-padded 01-12) + 2-digit year, e.g. "Nishant" at 11 AM in 2026 → "NIS1126".
export function generateReferralCode(name: string, date: Date = new Date()): string {
  const letters = String(name || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .padEnd(3, "X")
    .slice(0, 3);
  const hour12 = date.getHours() % 12 || 12;
  const hourStr = String(hour12).padStart(2, "0");
  const yearStr = String(date.getFullYear()).slice(-2);
  return `${letters}${hourStr}${yearStr}`;
}
