-- Super Admin > Super Meta > Scheduled Messages lets an admin Skip, Cancel or Reschedule one subscription-ending WhatsApp reminder.
-- This table remembers what was done and why. It is always written TOGETHER with a row in subscription_expiry_whatsapp_reminders
-- (the claim the daily 8 AM sweep checks before sending): the claim is what stops the sweep from sending that reminder on its own,
-- this row says it was an admin's decision, and for a reschedule, when to send instead.
--
--   subscription_id / period_end / days_before = the same key as the claim row (period_end is the subscription's end date, so a
--                                                renewal, a new period, is reminded afresh)
--   action        = skipped (this one reminder) | cancelled (all remaining reminders of the period) | rescheduled
--   scheduled_for = the 8 AM IST slot the sweep would have used, so the row stays on its own day in the list
--   send_at       = rescheduled only: when to send instead
--   sent_at       = rescheduled only: when that send went out (NULL while it is still waiting)
--   note          = optional reason shown in the list
--
-- Additive and re-runnable. Run once per environment, BEFORE deploying the backend that offers the actions (until then the list
-- still works and the actions answer that this has not been run).

CREATE TABLE IF NOT EXISTS subscription_expiry_whatsapp_overrides (
  subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  period_end      TIMESTAMPTZ NOT NULL,
  days_before     INT         NOT NULL,
  action          TEXT        NOT NULL CHECK (action IN ('skipped', 'cancelled', 'rescheduled')),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  send_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  note            TEXT,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, period_end, days_before)
);

-- The "send what is due" check looks only at reschedules that have not gone out yet.
CREATE INDEX IF NOT EXISTS idx_sub_expiry_wa_overrides_due
  ON subscription_expiry_whatsapp_overrides (send_at)
  WHERE action = 'rescheduled' AND sent_at IS NULL;
