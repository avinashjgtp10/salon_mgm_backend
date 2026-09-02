-- Stock Ledger: a full audit trail of every stock movement for a product —
-- purchases, usage, sales, returns, damage, expiry, manual adjustments and
-- branch transfers — each row capturing the balance immediately after the
-- movement so "why is my stock at X" can be answered from history alone
-- rather than recomputed. Distinct from the existing stock_movements table
-- (movement_type there is only 'in' | 'out' | 'adjustment' | 'transfer',
-- which can't express the ledger's requested transaction vocabulary without
-- overloading those four buckets) — this table is additive, not a
-- replacement, and existing stock_movements writers are untouched.

CREATE TABLE IF NOT EXISTS stock_ledger (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL,
  branch_id         UUID          NOT NULL,
  product_id        UUID          NOT NULL REFERENCES products(id),
  transaction_type  VARCHAR(30)   NOT NULL
                    CHECK (transaction_type IN (
                      'opening_stock', 'purchase', 'usage', 'sale', 'return',
                      'damage', 'expired', 'adjustment_in', 'adjustment_out',
                      'transfer_in', 'transfer_out'
                    )),
  reference         VARCHAR(100),
  -- Signed: positive for stock-in transaction types, negative for stock-out —
  -- lets balance_after be computed as a running SUM(quantity) per product
  -- without a separate direction column, and the API layer derives the
  -- displayed "In"/"Out" columns from the sign.
  quantity          NUMERIC(12,3) NOT NULL,
  unit_cost         NUMERIC(12,2),
  balance_after     NUMERIC(12,3) NOT NULL,
  reason            TEXT,
  notes             TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_salon_branch ON stock_ledger(salon_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product ON stock_ledger(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_transaction_type ON stock_ledger(transaction_type);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_created_at ON stock_ledger(created_at);
