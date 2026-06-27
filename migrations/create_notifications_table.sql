-- Creates the notifications table for in-app salon notifications

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID         NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  type       VARCHAR(30)  NOT NULL DEFAULT 'info',
  title      VARCHAR(255) NOT NULL,
  body       TEXT,
  is_read    BOOLEAN      NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_salon_created
  ON notifications (salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_salon_unread
  ON notifications (salon_id, is_read)
  WHERE is_read = false;
