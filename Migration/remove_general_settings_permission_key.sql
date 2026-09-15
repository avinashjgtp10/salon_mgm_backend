-- Removes general_settings entirely, per explicit instruction: don't leave
-- the old blanket permission around as a parallel path once the new
-- granular ones exist (same "delete old, implement new" rule already
-- applied to view_wages/manage_wages/manage_staff_personal_data,
-- manage_payroll, manage_commissions/manage_tips, design_coupons, and
-- export_reports earlier this session).
--
-- Unlike those, general_settings was still genuinely load-bearing — it was
-- the ONLY thing gating every write to the generic salon_settings key-value
-- store (Integrations/Notifications/Tax Mapping/Reward Points/Refer &
-- Earn/Packages/Print Settings, plus the legacy role_permissions/
-- subscription_permissions loopholes). Deleting the catalog row alone
-- would have left those writes completely unprotected — see
-- settings.controller.ts's assertCanWriteKey(), rewritten in this same
-- pass to map every one of those keys to its own dedicated
-- view_settings_<section> permission (from
-- add_settings_section_permission_keys.sql) before this migration removes
-- the old key, plus closes two known standing loopholes: role_permissions
-- writes now require manage_roles, and subscription_permissions is no
-- longer writable through this endpoint by anyone but super-admin's own
-- dedicated route.
--
-- Run this AFTER add_settings_section_permission_keys.sql and after
-- deploying the settings.routes.ts/settings.controller.ts code change —
-- running it before would leave every generic-settings write permanently
-- closed to staff (an inconvenience, not a security issue: owner/admin
-- always bypass) until the code catches up, but the intended order is
-- code-and-catalog-keys-first, then this cleanup last.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'general_settings';
DELETE FROM role_permissions WHERE permission_key = 'general_settings';
DELETE FROM staff_permission_overrides WHERE permission_key = 'general_settings';
DELETE FROM permissions WHERE key = 'general_settings';

COMMIT;
