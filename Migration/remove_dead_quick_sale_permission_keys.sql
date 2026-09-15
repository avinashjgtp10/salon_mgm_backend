-- Removes the 4 dead Quick Sale permission keys that nothing in the app
-- (frontend or backend) ever actually checks: view_quick_sale,
-- create_quick_sale, edit_quick_sale, delete_quick_sale. Real Quick Sale
-- access/create/edit/delete has always gone through view_sales/create_sales
-- instead (see sales.routes.ts) — these 4 were leftover catalog rows from
-- before that reconciliation, still shown as live toggles in Settings →
-- Roles & Permissions despite doing nothing when flipped.
--
-- import_sales ("Import Billing Data") is untouched — it's real, checked by
-- POST /sales/import, and stays in the Quick Sale group.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

-- Audit history rows referencing these keys are kept (before/after JSONB
-- already captures what changed) — only the now-invalid FK is cleared.
UPDATE permission_audit_log
SET permission_key = NULL
WHERE permission_key IN ('view_quick_sale', 'create_quick_sale', 'edit_quick_sale', 'delete_quick_sale');

DELETE FROM role_permissions
WHERE permission_key IN ('view_quick_sale', 'create_quick_sale', 'edit_quick_sale', 'delete_quick_sale');

DELETE FROM staff_permission_overrides
WHERE permission_key IN ('view_quick_sale', 'create_quick_sale', 'edit_quick_sale', 'delete_quick_sale');

DELETE FROM permissions
WHERE key IN ('view_quick_sale', 'create_quick_sale', 'edit_quick_sale', 'delete_quick_sale');

COMMIT;
