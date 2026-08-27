-- Supplier payouts: a ledger of payments made to a supplier, mirroring the
-- Payroll module's SalaryAdvanceTransaction pattern (a running-balance
-- append-only history rather than a single mutable "amount paid" column).
-- due_amount / status / etc. are DERIVED at query time from
-- purchases.total_amount minus SUM(supplier_payments.amount) — no stored
-- balance column, so there's nothing to keep in sync on writes to either
-- table. Per project policy this file is created but NOT auto-run; apply it
-- by hand against each environment before using the supplier-payments module.

CREATE TABLE IF NOT EXISTS supplier_payments (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID          NOT NULL,
  supplier_id           UUID          NOT NULL REFERENCES suppliers(id),
  amount                NUMERIC(12,2) NOT NULL,
  payment_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  payment_method        VARCHAR(20)   NOT NULL,
  note                  TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_salon ON supplier_payments(salon_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
