-- Moves view_coupons/manage_coupons from their own standalone "Coupons"
-- module card into Settings > Tools, alongside Integrations/POS/Billing/
-- Currency/Tax Mapping/Reward Points/Refer & Earn/Packages/Print Settings —
-- Coupons is already one of the 18 Settings sections access_settings ORs
-- across (see usePermissions.ts / SettingsLayout.tsx's navGroups), it was
-- just cataloged as its own separate module in Roles & Permissions instead
-- of nested inside Settings like its sibling sections.
--
-- Purely a catalog reorganization — no key renamed, no functional/backend
-- change, no re-grant needed (existing role_permissions/
-- staff_permission_overrides rows for these two keys are untouched).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET module = 'Settings', group_name = 'Tools'
WHERE key IN ('view_coupons', 'manage_coupons');

COMMIT;
