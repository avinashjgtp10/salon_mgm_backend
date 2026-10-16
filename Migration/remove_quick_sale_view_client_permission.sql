-- Quick Sale does not need its own "View Client" permission.
--
-- add_quick_sale_client_permission_keys.sql briefly created quick_sale_view_client ("Look up and view
-- client details from Quick Sale"). Looking up and selecting a client is simply part of Access Quick Sale
-- (create_sales), so a separate switch only added confusion. Quick Sale keeps its two real client
-- actions: quick_sale_edit_client and quick_sale_client_history.
--
-- Environments that already ran the earlier migration (dev) need this clean-up; new environments never get
-- the key because the earlier file no longer creates it.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each
-- environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'quick_sale_view_client';
DELETE FROM role_permissions WHERE permission_key = 'quick_sale_view_client';
DELETE FROM staff_permission_overrides WHERE permission_key = 'quick_sale_view_client';
DELETE FROM permissions WHERE key = 'quick_sale_view_client';

COMMIT;
