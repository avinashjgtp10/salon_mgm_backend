-- When a salon owner finished onboarding (set once, by the same atomic update that flips is_onboarding_complete). It is also the
-- record behind the one-time "onboarding complete" welcome email: that email is only sent by the call that sets it.
-- Owners who completed onboarding before this column existed keep NULL.
-- The app also adds this column by itself the first time it needs it; run this by hand if the database user may not alter tables.
-- Additive and re-runnable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
