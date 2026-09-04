-- Multi-channel notification templates (SMS / Email) — the WhatsApp-side
-- counterpart already lives in wa_automation_templates (Meta-approval
-- lifecycle, salon-editable) and stays there untouched. This table is
-- deliberately simpler: no external approval step, so "Save" is live
-- immediately. event_type is one of AutomationEventType's PURCHASE_EVENTS
-- (whatsapp-automation.types.ts) — no CHECK constraint here, same choice
-- wa_automation_templates itself makes, since that enum evolves over time;
-- enforced app-side instead via isPurchaseEventType().

CREATE TABLE IF NOT EXISTS notification_channel_templates (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID         NOT NULL,
  event_type  VARCHAR(50)  NOT NULL,
  channel     VARCHAR(10)  NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
  subject     TEXT         NULL,       -- EMAIL only; always NULL for SMS
  body        TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One live row per (salon, event, channel) — the repository's
-- findOrSeedTemplate does an upsert against this, same "create or move"
-- convention as wa_scheduled_messages' own partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_channel_tpl
  ON notification_channel_templates (salon_id, event_type, channel);

-- Lightweight send log — mirrors wa_automation_logs' role for these two new
-- channels (support/debuggability parity), write-only from the new
-- dispatcher, nothing else reads it yet.
CREATE TABLE IF NOT EXISTS notification_channel_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID        NOT NULL,
  client_id             UUID        NULL,
  channel               VARCHAR(10) NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  event_type            VARCHAR(50) NOT NULL,
  recipient             TEXT        NOT NULL,   -- phone or email address
  status                VARCHAR(20) NOT NULL CHECK (status IN ('SENT','FAILED','SKIPPED')),
  provider_message_id   TEXT        NULL,       -- Exotel Sid for SMS, nodemailer messageId for Email
  failure_reason        TEXT        NULL,
  reference_id          UUID        NULL,
  reference_type        VARCHAR(30) NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_channel_logs_salon
  ON notification_channel_logs (salon_id, created_at DESC);
