-- Marketing > Campaign contact table: per-contact manual Resend for a
-- FAILED/BLOCKED recipient. wa_campaign_contacts itself gets overwritten in
-- place on each attempt (status/error_code/error_message/wamid/timestamps),
-- so without this table a resend would silently erase the original
-- failure's audit trail the moment the new attempt's result lands. Safe to
-- re-run.

CREATE TABLE IF NOT EXISTS wa_campaign_contact_resends (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_contact_id    UUID NOT NULL REFERENCES wa_campaign_contacts(id) ON DELETE CASCADE,
  campaign_id            UUID NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
  salon_id               UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  previous_status        VARCHAR(20),
  previous_error_code    VARCHAR(50),
  previous_error_message TEXT,
  resent_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  resent_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_campaign_contact_resends_contact
  ON wa_campaign_contact_resends (campaign_contact_id);
