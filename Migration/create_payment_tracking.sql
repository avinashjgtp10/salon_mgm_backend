-- Super Admin > Payment Tracking (manual customer / website payments, money added, and the combined ledger).
--
-- Purely additive and separate from Razorpay: nothing here reads or writes subscriptions, subscription_payments or any Razorpay table.
--
--   admin_receivables          what a customer (kind = 'customer', e.g. a salon's plan) or a website client (kind = 'website') owes in total.
--   admin_receivable_payments  the installments received against it. Paid and remaining are always computed from these rows, never stored.
--   admin_money_added          money the Super Admin adds by hand. It is NOT business revenue and is never counted in customer/website totals.
--
-- The Money Ledger is not a table: it is a query over the installments and money-added rows, so a transaction can never be duplicated
-- in it. Voiding keeps the row (history) but removes it from every total and from the ledger.
--
-- Apply by hand per environment (dev -> QA -> prod). Idempotent, safe to re-run. Outside production the backend also creates these
-- tables itself the first time they are needed.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_receivables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('customer', 'website')),
  party_name   TEXT NOT NULL,
  salon_id     UUID REFERENCES salons(id) ON DELETE SET NULL,
  item_label   TEXT NOT NULL,                       -- the plan (customer) or the website project (website)
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  due_date     DATE,
  notes        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Website projects: what the domain cost us, so the profit (total amount - domain cost) can be shown. Zero for customer records.
ALTER TABLE admin_receivables ADD COLUMN IF NOT EXISTS domain_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (domain_cost >= 0);

CREATE INDEX IF NOT EXISTS idx_admin_receivables_kind ON admin_receivables (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_receivable_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id UUID NOT NULL REFERENCES admin_receivables(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  method        VARCHAR(30),
  reference     TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at     TIMESTAMPTZ,
  voided_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_receivable_payments_receivable ON admin_receivable_payments (receivable_id);
CREATE INDEX IF NOT EXISTS idx_admin_receivable_payments_date ON admin_receivable_payments (paid_on DESC);

CREATE TABLE IF NOT EXISTS admin_money_added (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  added_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  category    VARCHAR(40),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      VARCHAR(30),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at   TIMESTAMPTZ,
  voided_by   UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_money_added_date ON admin_money_added (added_on DESC);

COMMIT;
