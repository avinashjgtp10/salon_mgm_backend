-- One row per "subscription is about to expire" reminder email that has been sent, so a sweep that runs again (a restart, a second
-- instance, the next day) never sends the same reminder twice. The primary key is the claim: INSERT ... ON CONFLICT DO NOTHING.
--
--   period_end  = the subscription's current_period_end when it was sent, so a renewal (new period) is reminded afresh
--   days_before = which reminder it was: 5, 4, 3, 2 or 1 days before the expiry, or 0 on the expiry day
--
-- The app also creates this table by itself the first time the reminder sweep runs; run this by hand if the database user may not
-- create tables. Additive and re-runnable.

CREATE TABLE IF NOT EXISTS subscription_expiry_reminders (
  subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  period_end      TIMESTAMPTZ NOT NULL,
  days_before     INT         NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, period_end, days_before)
);
