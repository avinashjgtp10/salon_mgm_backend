exports.shorthands = undefined;

// Mirrors create_reward_points_tables.sql exactly (same pattern: a running
// balance column on clients + a dedicated ledger table for full per-event
// history), so referral rewards can be tracked independently of eWallet
// instead of being merged into clients.ewallet_balance via a source_type tag.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS referral_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS referral_ledger (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      salon_id       UUID NOT NULL,
      type           VARCHAR(10) NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust')),
      amount         NUMERIC(12,2) NOT NULL,
      balance_after  NUMERIC(12,2) NOT NULL,
      source_type    VARCHAR(20),
      source_id      UUID,
      note           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_referral_ledger_client ON referral_ledger (client_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS referral_ledger;`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS referral_balance;`);
};
