-- Self-serve plan payments via Razorpay Orders + Checkout (one-time payments,
-- India / INR). One row per checkout attempt; a row is only flipped to 'paid'
-- after the backend has verified the payment with Razorpay (amount, order id,
-- captured status) and activated the salon's term in the same transaction.
--
-- razorpay_order_id and razorpay_payment_id are UNIQUE: that is what makes
-- activation idempotent when the browser verify call and the webhook race, or
-- when Razorpay retries a webhook.
--
-- Run by hand. Safe to re-run. Requires create_salon_plans_system_tables.sql
-- (salon_plan_invoices) to have been run first.

CREATE TABLE IF NOT EXISTS salon_plan_payments (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id             UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id              UUID          REFERENCES users(id),
  plan_tier            VARCHAR(20)   NOT NULL REFERENCES salon_plan_definitions(tier),
  billing_cycle        VARCHAR(20)   NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  subtotal             NUMERIC(10,2) NOT NULL,          -- listed price, before GST
  gst_amount           NUMERIC(10,2) NOT NULL,
  total_amount         NUMERIC(10,2) NOT NULL,          -- what the customer pays
  amount_paise         BIGINT        NOT NULL,          -- total_amount in paise, as sent to Razorpay
  currency             CHAR(3)       NOT NULL DEFAULT 'INR',
  status               VARCHAR(20)   NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  razorpay_order_id    TEXT          NOT NULL UNIQUE,
  razorpay_payment_id  TEXT          UNIQUE,
  payment_method       TEXT,
  term_start           TIMESTAMPTZ,
  term_end             TIMESTAMPTZ,
  invoice_id           UUID          REFERENCES salon_plan_invoices(id) ON DELETE SET NULL,
  failure_reason       TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_plan_payments_salon ON salon_plan_payments(salon_id, created_at DESC);

-- Webhook de-duplication: Razorpay sends x-razorpay-event-id on every
-- delivery and retries on non-2xx, so the same event can arrive repeatedly.
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  event_id     TEXT         PRIMARY KEY,
  event_type   TEXT         NOT NULL,
  received_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
