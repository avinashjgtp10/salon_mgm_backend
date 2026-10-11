-- Lets a brand-new account pay for a plan BEFORE its salon exists.
--
-- New sign-ups are sent from "Create account" straight to the subscription
-- page, but the salon row is only created at the end of onboarding
-- (POST /salons). So a payment may be taken with no salon yet: it is stored
-- against the user (salon_id NULL, applied_at NULL) and applied to the salon —
-- subscription + plan tier + term — the moment onboarding creates it.
--
-- Run AFTER create_salon_plan_payments.sql. Safe to re-run.

ALTER TABLE salon_plan_payments ALTER COLUMN salon_id DROP NOT NULL;
ALTER TABLE salon_plan_payments ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Rows paid before this migration were all applied immediately.
UPDATE salon_plan_payments
   SET applied_at = COALESCE(paid_at, updated_at)
 WHERE status IN ('paid', 'refunded') AND salon_id IS NOT NULL AND applied_at IS NULL;

-- "Paid but not yet attached to a salon" lookups, per user.
CREATE INDEX IF NOT EXISTS idx_salon_plan_payments_unapplied
  ON salon_plan_payments(user_id)
  WHERE salon_id IS NULL AND applied_at IS NULL;
