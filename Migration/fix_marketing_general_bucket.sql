-- Fixes the "General" ungrouped bucket the Marketing permissions ticket
-- exposed in Settings → Roles & Permissions → Marketing. Four permissions
-- had module='Marketing' but no group_name, landing in an unintended 8th
-- section alongside the ticket's 7 (General/Analytics/Campaigns/Dashboard/
-- Inbox/Scheduled Templates/Templates/WhatsApp Config): manage_whatsapp_config
-- (already superseded — see remove_manage_whatsapp_config_permission_key.sql,
-- nothing more to do here), design_coupons, view_coupons, manage_coupons.
--
-- design_coupons is fully dead — confirmed via grep, no backend route or
-- frontend can() check anywhere references it — removed entirely, same
-- treatment as every other confirmed-dead key this session.
--
-- view_coupons/manage_coupons are NOT dead — they actively gate a real,
-- working Coupons CRUD feature (coupons.routes.ts, Settings → Coupons).
-- Explicit instruction: keep them working, but don't show them under
-- Marketing at all — moved to their own module='Coupons' (a separate
-- top-level section in Roles & Permissions, not nested under Marketing).
-- No functional change, purely a display fix. A live-DB check confirmed
-- neither is currently granted to any role/staff member, so this doesn't
-- change anyone's access today; it only fixes where the toggle appears
-- when an owner does look.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET module = 'Coupons', group_name = 'Coupons' WHERE module = 'Marketing' AND key IN ('view_coupons', 'manage_coupons');

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'design_coupons';
DELETE FROM role_permissions WHERE permission_key = 'design_coupons';
DELETE FROM staff_permission_overrides WHERE permission_key = 'design_coupons';
DELETE FROM permissions WHERE key = 'design_coupons';

COMMIT;
