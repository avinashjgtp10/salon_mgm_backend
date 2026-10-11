-- Tracks whether the ticket owner has seen the support team's latest reply, so
-- the Help page / sidebar can show a "new reply" notification. NULL together
-- with a non-NULL admin_reply = unread.
-- Per project policy this file is created but NOT auto-run; apply by hand.
BEGIN;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reply_read_at TIMESTAMPTZ;
-- Replies that already exist were effectively delivered before this feature;
-- mark them read so nobody gets a flood of "new reply" notifications on rollout.
UPDATE support_tickets SET reply_read_at = COALESCE(replied_at, NOW())
 WHERE admin_reply IS NOT NULL AND reply_read_at IS NULL;
COMMIT;
