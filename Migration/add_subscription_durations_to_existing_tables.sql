-- Dynamic Subscription Duration & Pricing (3 / 6 / 12 months or custom): NO new tables, only ALTERs on existing ones.
--
--   subscription_plans    one row per plan + term (the same pattern the app already uses: "a plan's price per cycle is one subscription_plans
--                         row"). Duration rows have slug 'duration-<tier>-<value>-<unit>' and duration_value IS NOT NULL; every existing
--                         row (salonox-<tier>-monthly/quarterly/yearly, manual-grant) keeps NULL in the new columns and is untouched.
--   subscription_payments one row per Razorpay Orders purchase. It starts as payment_status 'pending' (subscription_id NULL) and becomes
--                         'paid' + linked to the new subscription once the payment is verified. Price / GST / duration are snapshotted on it.
--   subscriptions         nullable purchase snapshot columns (NULL for every existing subscription).
--
-- Features / permissions are not stored here: a purchased term inherits its tier's module_plans entry (salonModulesService.applyPlanTier).
-- Additive and safe to run more than once. Per project policy this file is NOT auto-run: apply it by hand to dev, QA, then prod,
-- BEFORE deploying the backend that uses it. Until it is applied the duration screens show nothing and the old plans keep working.

BEGIN;

-- ── subscription_plans: the purchasable terms ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS duration_label   VARCHAR(60),
  ADD COLUMN IF NOT EXISTS duration_value   INTEGER,
  ADD COLUMN IF NOT EXISTS duration_unit    VARCHAR(10),          -- days | months | years
  ADD COLUMN IF NOT EXISTS gst_percent      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS gst_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS final_price      NUMERIC(12,2),        -- price (before GST) + gst_amount: what the customer pays
  ADD COLUMN IF NOT EXISTS is_recommended   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived      BOOLEAN NOT NULL DEFAULT FALSE;   -- a term that was bought, then edited/removed: kept as history

-- One live term per plan and length (archived history rows are exempt).
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_plans_duration
  ON subscription_plans (tier, duration_value, duration_unit)
  WHERE duration_value IS NOT NULL AND is_archived = FALSE;

-- ── subscription_payments: the purchase (order) record ─────────────────────────────────────────────────────────────────────
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS salon_id             UUID,
  ADD COLUMN IF NOT EXISTS user_id              UUID,
  ADD COLUMN IF NOT EXISTS plan_id              UUID,             -- the subscription_plans term row that was bought
  ADD COLUMN IF NOT EXISTS purchase_kind        VARCHAR(10),      -- new | renewal | upgrade
  ADD COLUMN IF NOT EXISTS duration_label       VARCHAR(60),      -- snapshot of the term at purchase time
  ADD COLUMN IF NOT EXISTS duration_value       INTEGER,
  ADD COLUMN IF NOT EXISTS duration_unit        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS base_price           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gst_percent          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS gst_amount           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS razorpay_order_id    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS signature_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failure_reason       TEXT,
  ADD COLUMN IF NOT EXISTS period_start         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_rzp_order   ON subscription_payments (razorpay_order_id)   WHERE razorpay_order_id   IS NOT NULL;
-- One Razorpay payment can activate at most ONE purchase, so a repeated webhook / double click can never grant two terms.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_rzp_payment ON subscription_payments (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_subscription_payments_salon_dur  ON subscription_payments (salon_id, created_at DESC) WHERE duration_value IS NOT NULL;

-- ── subscriptions: snapshot of what was bought (NULL for every existing / non-duration subscription) ──────────────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS duration_order_id     UUID,             -- the subscription_payments row of the purchase
  ADD COLUMN IF NOT EXISTS duration_label        VARCHAR(60),
  ADD COLUMN IF NOT EXISTS duration_value        INTEGER,
  ADD COLUMN IF NOT EXISTS duration_unit         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS purchase_base_price   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS purchase_gst_percent  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS purchase_gst_amount   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS purchase_total        NUMERIC(12,2);

-- ── One-off: bring over options created with the earlier (two-table) version, where that version was run ─────────────────────
DO $$
BEGIN
  IF to_regclass('subscription_duration_options') IS NOT NULL THEN
    INSERT INTO subscription_plans
      (name, slug, description, price, billing_cycle, is_active, tier,
       duration_label, duration_value, duration_unit, gst_percent, gst_amount, final_price, is_recommended, sort_order)
    SELECT 'SalonOx ' || initcap(o.tier),
           'duration-' || o.tier || '-' || o.duration_value || '-' || o.duration_unit,
           'Prepaid ' || o.label,
           o.base_price, LEFT(o.label, 20), o.is_active, o.tier,
           o.label, o.duration_value, o.duration_unit, o.gst_percent, o.gst_amount, o.final_price, o.is_recommended, o.sort_order
      FROM subscription_duration_options o
    ON CONFLICT (slug) DO NOTHING;
  END IF;
END $$;

COMMIT;

-- ── Optional clean-up, run by hand ONLY after checking the data above was copied ───────────────────────────────────────────
-- The two tables below belong to the earlier version and are no longer used. Any purchase attempts in them were never linked to a
-- subscription (check first: SELECT status, COUNT(*) FROM subscription_duration_orders GROUP BY 1;).
--   DROP TABLE IF EXISTS subscription_duration_orders;
--   DROP TABLE IF EXISTS subscription_duration_options;
