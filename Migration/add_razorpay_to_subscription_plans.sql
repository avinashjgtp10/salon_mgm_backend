-- Razorpay-backed subscription plans (Basic / Advance / Growth, monthly + yearly).
--
-- Lean by design: no new tables. A plan's price per cycle is one subscription_plans row
-- (slug salonox-<tier>-<monthly|yearly>); its Razorpay plan id lives on that row. Features come from
-- module_plans (same tier slug), so nothing is duplicated.
--
-- Razorpay plans are immutable: changing an amount creates a NEW Razorpay plan and the row's
-- razorpay_plan_id is replaced. Existing Razorpay subscriptions keep the old amount.
--
-- Additive and re-runnable.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS tier             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS razorpay_plan_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_tier ON subscription_plans (tier);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_razorpay_subscription_id
  ON subscriptions (razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;

-- subscription_payments pointed at the unused salon_subscriptions table, so no payment could ever be
-- recorded against a real subscription. Repoint it at subscriptions (only when it is still empty/valid).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_payments_subscription_id_fkey'
      AND confrelid = 'salon_subscriptions'::regclass
  ) THEN
    ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_subscription_id_fkey;
    IF NOT EXISTS (
      SELECT 1 FROM subscription_payments p
      WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = p.subscription_id)
    ) THEN
      ALTER TABLE subscription_payments
        ADD CONSTRAINT subscription_payments_subscription_id_fkey
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
