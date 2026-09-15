-- manage_client_purchase_history removed — selling/editing/cancelling a
-- client's packages and memberships is role-only now (owner/admin/staff,
-- see client-packages.routes.ts / client-memberships.routes.ts), no
-- dedicated fine-grained permission. Reads of that same data still work via
-- view_clients or view_appointment, unaffected by this removal.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'manage_client_purchase_history';
DELETE FROM role_permissions WHERE permission_key = 'manage_client_purchase_history';
DELETE FROM staff_permission_overrides WHERE permission_key = 'manage_client_purchase_history';
DELETE FROM permissions WHERE key = 'manage_client_purchase_history';

COMMIT;
