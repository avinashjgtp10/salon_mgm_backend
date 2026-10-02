BEGIN;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS notification_staff_reads (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_user_ids_idx ON notifications USING gin(recipient_user_ids);
COMMIT;
