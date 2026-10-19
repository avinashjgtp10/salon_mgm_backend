-- SalonOx -> salon software-subscription tax invoices (the bill a salon gets for its plan payment).
--
-- One row per paid subscription payment (payment_id UNIQUE, so a Razorpay retry can never bill twice), or a manual
-- row (payment_id NULL) for offline / bank-transfer payments a super admin records by hand. Amounts are stored,
-- not recomputed, so an invoice never changes after it is issued even if GST or plan prices change later.
--
--   subtotal   = price before GST
--   gst_amount = GST on it (gst_percent, 18 today)
--   total      = what the salon paid
--
-- Numbering: one global sequence, shown as FY<yy><yy>/<n>, e.g. FY2627/01 (Indian financial year Apr-Mar).
-- Additive and re-runnable.

CREATE SEQUENCE IF NOT EXISTS subscription_invoice_no_seq START 1;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no      VARCHAR(30)   NOT NULL UNIQUE,
  salon_id        UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  subscription_id UUID          REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_id      UUID          UNIQUE REFERENCES subscription_payments(id) ON DELETE SET NULL,
  plan_name       VARCHAR(100),
  billing_cycle   VARCHAR(20),
  period_start    DATE,
  period_end      DATE,
  subtotal        NUMERIC(12,2) NOT NULL,
  gst_percent     NUMERIC(5,2)  NOT NULL DEFAULT 18,
  gst_amount      NUMERIC(12,2) NOT NULL,
  total           NUMERIC(12,2) NOT NULL,
  payment_mode    VARCHAR(40),
  transaction_id  VARCHAR(80),
  status          VARCHAR(10)   NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void')),
  issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  emailed_at      TIMESTAMPTZ,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_salon  ON subscription_invoices (salon_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_issued ON subscription_invoices (issued_at DESC);
