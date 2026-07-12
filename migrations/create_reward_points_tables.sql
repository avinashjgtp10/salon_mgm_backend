ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS reward_points_balance NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reward_points_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  salon_id       UUID NOT NULL,
  type           VARCHAR(10) NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust')),
  points         NUMERIC(12,2) NOT NULL,
  balance_after  NUMERIC(12,2) NOT NULL,
  source_type    VARCHAR(20),
  source_id      UUID,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reward_points_ledger_client ON reward_points_ledger (client_id, created_at DESC);
