// Stored as the `value` of a salon_settings row keyed "REFERRAL_CONFIG"
// (same generic key/value store as REWARD_POINTS_CONFIG — see reward-points.types.ts).
export type ReferralConfig = {
  active: boolean;
  referrer_reward_amount: number; // ₹ credited to the referrer's wallet
  referee_reward_amount: number;  // ₹ credited to the new/referred customer's wallet
  min_bill_amount: number;        // referred customer's first paid bill must be ≥ this to unlock rewards
  max_wallet_usage_pct: number;   // max % of a bill that can be paid using wallet balance
  redeem_enabled: boolean;        // whether Referral Credit can be redeemed toward a bill at all
  // Most of the bill (before any membership/eWallet/reward/referral
  // deduction) that Referral Credit alone may ever cover — e.g. 20 means a
  // ₹1,000 bill can have at most ₹200 paid via referral credit, however much
  // credit the client has. 100 = no extra cap beyond balance/remaining-bill.
  max_redeem_percent: number;
};

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  active: false,
  referrer_reward_amount: 100,
  referee_reward_amount: 50,
  min_bill_amount: 1000,
  max_wallet_usage_pct: 100,
  // Defaults to enabled/uncapped so existing salons with a referral_balance
  // already on client records see no behavior change until they configure
  // otherwise — this is a new cap, not a new baseline restriction.
  redeem_enabled: true,
  max_redeem_percent: 100,
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
