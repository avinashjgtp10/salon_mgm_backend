-- View Products and View Suppliers are independent permissions: turning View
-- Products on must not auto-enable View Suppliers, and staff may view products
-- without access to supplier information.
--
-- Reverses the depends_on edge added by
-- add_view_products_requires_view_suppliers.sql. The frontend already ignores
-- this edge (permissionCascade.ts IGNORED_DEPENDENCIES); this brings the
-- catalog in line with it.
--
-- Deliberately does NOT touch role_permissions / staff_permission_overrides:
-- the earlier backfill set view_suppliers = true on existing roles, and those
-- rows can't be told apart from deliberate grants. Turn Supplier View off by
-- hand on any role that shouldn't have it.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET depends_on = NULL WHERE key = 'view_products';

COMMIT;
