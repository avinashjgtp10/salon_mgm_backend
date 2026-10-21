-- Plan upgrades (e.g. Advance -> Growth) with a prorated, credit-adjusted price, paid through a one-time Razorpay order.
--
-- One row per upgrade ATTEMPT. The quote (all amounts) is computed on the backend when the attempt is created and stored
-- here, so what the salon was shown is what it is charged and what the invoice later says; the browser never sends an
-- amount. Nothing about the salon's plan changes until the attempt is 'completed' (payment verified, or zero payable).
--
--   kind 'upgrade'      same billing cycle: the current end date is KEPT, the salon pays the prorated difference
--   kind 'term_change'  different billing cycle: a new term starts today, minus the unused value of the old one
--
-- Idempotency: razorpay_order_id and razorpay_payment_id are UNIQUE, and an attempt can only move out of 'pending' once
-- (the completing code locks the row and checks), so repeated callbacks cannot activate it twice. At most one attempt per
-- salon can be 'pending' at a time.
--
-- Also adds to subscription_invoices what an upgrade invoice needs to say (kind, credit applied, description).
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS subscription_upgrades (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  from_subscription_id  UUID          REFERENCES subscriptions(id) ON DELETE SET NULL,
  to_plan_id            UUID          NOT NULL REFERENCES subscription_plans(id),
  to_tier               VARCHAR(20),
  to_cycle              VARCHAR(20)   NOT NULL,
  kind                  VARCHAR(20)   NOT NULL DEFAULT 'upgrade' CHECK (kind IN ('upgrade', 'term_change')),
  period_start          TIMESTAMP     NOT NULL,
  period_end            TIMESTAMP     NOT NULL,
  total_days            INT           NOT NULL,
  remaining_days        INT           NOT NULL,
  current_paid          NUMERIC(12,2) NOT NULL DEFAULT 0,
  new_plan_charge       NUMERIC(12,2) NOT NULL,
  credit_applied        NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal              NUMERIC(12,2) NOT NULL,
  gst_percent           NUMERIC(5,2)  NOT NULL,
  gst_amount            NUMERIC(12,2) NOT NULL,
  total                 NUMERIC(12,2) NOT NULL,
  status                VARCHAR(20)   NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'needs_review')),
  razorpay_order_id     VARCHAR(64)   UNIQUE,
  razorpay_payment_id   VARCHAR(64)   UNIQUE,
  new_subscription_id   UUID          REFERENCES subscriptions(id) ON DELETE SET NULL,
  failure_reason        TEXT,
  created_by            UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_upgrades_one_pending
  ON subscription_upgrades (salon_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_subscription_upgrades_salon
  ON subscription_upgrades (salon_id, created_at DESC);

ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS kind          VARCHAR(20)   NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upgrade_id    UUID          REFERENCES subscription_upgrades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description   TEXT;
