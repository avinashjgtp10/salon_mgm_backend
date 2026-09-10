export type RewardPointsLedgerType = 'earn' | 'redeem' | 'adjust';

export type RewardPointsLedgerEntry = {
  id: string;
  client_id: string;
  salon_id: string;
  type: RewardPointsLedgerType;
  points: number;
  balance_after: number;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_at: string;
};

// Stored as the `value` of a salon_settings row keyed "REWARD_POINTS_CONFIG".
export type RewardPointsConfig = {
  active: boolean;
  spend_amount: number;   // customer spends this much...
  points_earned: number;  // ...to earn this many points
  redeem_points: number;  // this many points...
  redeem_value: number;   // ...are worth this much ₹ off the bill
  // Most of the bill (before any membership/eWallet/reward/referral
  // deduction — the same preRedemptionTotal basis membership wallet is
  // capped against) that reward points alone may ever cover. 100 = no
  // extra cap beyond the existing balance/remaining-bill limits.
  max_redeem_percent: number;
};

export const DEFAULT_REWARD_POINTS_CONFIG: RewardPointsConfig = {
  active: false,
  spend_amount: 1000,
  points_earned: 100,
  redeem_points: 100,
  redeem_value: 50,
  max_redeem_percent: 100,
};
