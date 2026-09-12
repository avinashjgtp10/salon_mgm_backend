-- Removes manage_cash_register/manage_cash_transactions — superseded by the
-- Cash Management ticket's dedicated open_counter/close_counter and
-- add_expense/edit_expense/delete_expense keys (see
-- add_cash_management_permission_keys.sql). A live-DB check before this
-- migration was written confirmed neither key has ever been granted to any
-- role or staff member, so this is safe cleanup, not a functional change —
-- cash-management.routes.ts no longer references either string.
--
-- Safe to run whether or not these keys were ever granted — the DELETEs are
-- no-ops otherwise.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log
SET permission_key = NULL
WHERE permission_key IN ('manage_cash_register', 'manage_cash_transactions');

DELETE FROM role_permissions
WHERE permission_key IN ('manage_cash_register', 'manage_cash_transactions');

DELETE FROM staff_permission_overrides
WHERE permission_key IN ('manage_cash_register', 'manage_cash_transactions');

DELETE FROM permissions
WHERE key IN ('manage_cash_register', 'manage_cash_transactions');

COMMIT;
