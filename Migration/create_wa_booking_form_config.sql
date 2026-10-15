-- Marketing > Message Settings > Booking form: the salon owner's own choices for
-- the WhatsApp booking form (which questions to ask, their labels, the time-slot
-- range, the form title / button text). One row per salon; `config` is JSON so
-- new options need no further migration. A salon with no row gets the built-in
-- defaults, so this can be run before or after deploying. Safe to re-run.
-- Run on dev, QA and prod BEFORE deploying the backend that saves booking-form edits.

CREATE TABLE IF NOT EXISTS wa_booking_form_config (
  salon_id    UUID PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
