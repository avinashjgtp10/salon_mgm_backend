-- Super Admin can reply directly to one salon user's chatbot question. The reply is
-- stored on the question row itself, so only the user who asked (user_id + salon_id)
-- ever sees it. admin_reply_read_at NULL with a non-NULL admin_reply = unread.
-- Per project policy this file is created but NOT auto-run; apply by hand.
BEGIN;
ALTER TABLE bot_questions ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE bot_questions ADD COLUMN IF NOT EXISTS admin_replied_at TIMESTAMPTZ;
ALTER TABLE bot_questions ADD COLUMN IF NOT EXISTS admin_reply_read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bot_questions_user_reply ON bot_questions(user_id, salon_id) WHERE admin_reply IS NOT NULL;
COMMIT;
