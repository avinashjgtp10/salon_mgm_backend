-- Pay-before-onboarding: a subscription can now start before the owner's salon exists.
--
-- The salon is only created during onboarding (business-name step), but the owner is shown the Razorpay plan page
-- right after registering. So a subscription row may be created for a USER with no salon yet (salon_id NULL); when
-- onboarding creates the salon, rows with that user_id and no salon are attached to it.
--
-- Additive except salon_id losing NOT NULL; every existing query filters or joins on salon_id, so NULL rows are
-- simply invisible to them until attached. Re-runnable.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subscriptions
  ALTER COLUMN salon_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_unattached
  ON subscriptions (user_id) WHERE salon_id IS NULL;
