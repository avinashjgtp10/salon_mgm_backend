-- Marketing > WhatsApp Flows: remembers each salon's published "Book an
-- appointment" form (a Meta WhatsApp Flow). One row per salon - publishing a
-- new form (e.g. after the service list changes) replaces flow_id, since a
-- published Meta Flow cannot be edited in place. Run on dev, QA and prod BEFORE
-- deploying the backend that creates booking forms. Safe to re-run.

CREATE TABLE IF NOT EXISTS wa_booking_flows (
  salon_id    UUID PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  flow_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
