ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS installation_id TEXT,
  ADD COLUMN IF NOT EXISTS last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_installation
  ON device_tokens (user_id, salon_id, platform, installation_id)
  WHERE installation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_notification_receipts (
  receipt_id      TEXT PRIMARY KEY,
  notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
  salon_id        UUID REFERENCES salons(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ok', 'error')),
  error_code      TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_notification_receipts_due
  ON push_notification_receipts (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_push_notification_receipts_token
  ON push_notification_receipts (expo_push_token);

CREATE INDEX IF NOT EXISTS idx_push_notification_receipts_notification
  ON push_notification_receipts (notification_id);
