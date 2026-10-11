-- Marketing > Booking form: per-salon switch "send the booking form automatically
-- when a customer replies" (only when their 24h window had been closed, at most
-- once per 24h per customer). Run on dev, QA and prod BEFORE deploying the
-- backend that reads it; without it the toggle reports a clear error and the
-- rest of the booking form keeps working. Safe to re-run.

ALTER TABLE wa_booking_flows
  ADD COLUMN IF NOT EXISTS auto_send BOOLEAN NOT NULL DEFAULT FALSE;
