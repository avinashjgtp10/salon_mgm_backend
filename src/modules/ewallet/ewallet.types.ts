export type EwalletLedgerType = 'topup' | 'redeem' | 'adjust';

export type EwalletLedgerEntry = {
  id: string;
  client_id: string;
  salon_id: string;
  type: EwalletLedgerType;
  amount: number;
  balance_after: number;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  payment_method: string | null;
  created_by: string | null;
  created_at: string;
};

export type TopUpEwalletBody = {
  amount: number;
  payment_method: string;
  note?: string;
};

// Powers the "ⓘ" wallet breakdown popup on a client's profile. `reward_credits`
// is informational only — the ₹ value of the client's separate reward-points
// balance, which is redeemed at checkout rather than ever landing in this ledger.
export type WalletBreakdown = {
  referral_rewards: number;
  reward_credits: number;
  other_credits: number;
  wallet_debits: number;
  balance: number;
};
