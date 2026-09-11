-- Removes manage_whatsapp_config — superseded by the Marketing/WhatsApp
-- Config ticket's dedicated view_whatsapp_config/edit_whatsapp_config pair
-- (see add_marketing_permission_keys.sql). config.routes.ts no longer
-- references this key. A live-DB check before this migration was written
-- confirmed it has never been granted to any role or staff member.
--
-- Note: view_wa_automation/manage_wa_automation are NOT touched here — they
-- remain in active use by whatsapp-automation.routes.ts's message-log and
-- automation-settings endpoints, which are a different area, out of scope
-- for this ticket. Only their (former) use on the Scheduled Templates
-- routes was replaced.
--
-- Safe to run whether or not manage_whatsapp_config was ever granted — the
-- DELETEs are no-ops otherwise.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'manage_whatsapp_config';
DELETE FROM role_permissions WHERE permission_key = 'manage_whatsapp_config';
DELETE FROM staff_permission_overrides WHERE permission_key = 'manage_whatsapp_config';
DELETE FROM permissions WHERE key = 'manage_whatsapp_config';

COMMIT;
