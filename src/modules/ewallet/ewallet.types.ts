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
  created_by: string | null;
  created_at: string;
};

export type TopUpEwalletBody = {
  amount: number;
  note?: string;
};
