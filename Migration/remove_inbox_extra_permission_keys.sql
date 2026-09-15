-- Trims Inbox from 4 permissions down to 2, per explicit follow-up request
-- after reviewing the Roles & Permissions panel: view_conversation was
-- redundant with view_inbox (opening a thread is part of using the inbox,
-- not a separate real gate), and send_message/reply_to_conversation gated
-- the exact same single action under two names. reply_to_conversation was
-- kept as the survivor (matches inbox.routes.ts's actual route name);
-- view_conversation and send_message are removed entirely.
--
-- inbox.routes.ts no longer references either key — GET
-- /conversations/:phone/messages now uses view_inbox, and POST
-- /conversations/:phone/reply now uses reply_to_conversation alone.
--
-- A live-DB check before this migration was written found no grants for
-- either key in role_permissions or staff_permission_overrides at the time,
-- but this DELETE is safe to run regardless — any grant made since is
-- cleaned up the same way.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key IN ('view_conversation', 'send_message');
DELETE FROM role_permissions WHERE permission_key IN ('view_conversation', 'send_message');
DELETE FROM staff_permission_overrides WHERE permission_key IN ('view_conversation', 'send_message');
DELETE FROM permissions WHERE key IN ('view_conversation', 'send_message');

COMMIT;
