-- The "Data & Privacy" section was removed from Settings (frontend: DataPrivacyPage + its card, nav entry and
-- the "Data" group are gone), so its "open this section" permission has nothing left to gate.
--
-- add_settings_section_permission_keys.sql created view_settings_data_privacy ("Open the Data & Privacy settings
-- section"). Left in place it would keep showing up as a dead switch in Roles & Permissions. No replacement key
-- is needed: there is no section to open, so a role that held it loses nothing it could still use. (Account
-- deletion, the one live action on that page, also lives on Account & Security, under view_settings_account_security.)
--
-- Run this AFTER the frontend that no longer shows the section is deployed. Running it earlier only makes the old
-- Data & Privacy card show as permission-denied for everyone until the deploy lands.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each
-- environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'view_settings_data_privacy';
DELETE FROM role_permissions WHERE permission_key = 'view_settings_data_privacy';
DELETE FROM staff_permission_overrides WHERE permission_key = 'view_settings_data_privacy';
DELETE FROM permissions WHERE key = 'view_settings_data_privacy';

COMMIT;
