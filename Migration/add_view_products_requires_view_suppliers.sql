-- Product List permission ticket: Product List (view_products) shows a
-- Supplier column/filter, populated via a background fetch to the
-- Suppliers list endpoint — which 403s if the role/staff has view_products
-- but not view_suppliers (reported live on dev/QA: Products page pops a
-- "Permission Required" toast for view_suppliers on load). Rather than
-- silently OR'ing view_products into that endpoint (which would make
-- granting view_suppliers optional whenever view_products is on — the
-- opposite of what's wanted), view_products now formally depends_on
-- view_suppliers: the Roles & Permissions editors auto-enable View
-- Suppliers when View Products is turned on, and refuse to save a state
-- where View Products is on and View Suppliers is off (frontend-only
-- validation — see permissionCascade.ts's findMissingPrerequisites).
--
-- Scoped to ONLY view_suppliers (the read Product List actually needs) —
-- Add/Edit/Delete/Payout Supplier stay fully independent, per the ticket's
-- explicit instruction.
--
-- Also backfills the CURRENT broken state: any role or staff override that
-- already has view_products = true but no corresponding view_suppliers
-- grant gets one added (defaulting it true), so existing accounts stop
-- 403ing immediately rather than only preventing the problem going forward.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET depends_on = ARRAY['view_suppliers'] WHERE key = 'view_products';

-- Backfill: any role with view_products=true gets view_suppliers=true too,
-- unless it already has an explicit (even false) view_suppliers row —
-- respects a deliberate prior choice rather than overwriting it.
INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'view_suppliers', true
FROM role_permissions
WHERE permission_key = 'view_products' AND allowed = true
  AND role_id NOT IN (
    SELECT role_id FROM role_permissions WHERE permission_key = 'view_suppliers'
  );

UPDATE role_permissions SET allowed = true
WHERE permission_key = 'view_suppliers' AND allowed = false
  AND role_id IN (
    SELECT role_id FROM role_permissions WHERE permission_key = 'view_products' AND allowed = true
  );

-- Same backfill for per-staff overrides.
INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed)
SELECT staff_id, 'view_suppliers', true
FROM staff_permission_overrides
WHERE permission_key = 'view_products' AND allowed = true
  AND staff_id NOT IN (
    SELECT staff_id FROM staff_permission_overrides WHERE permission_key = 'view_suppliers'
  );

UPDATE staff_permission_overrides SET allowed = true
WHERE permission_key = 'view_suppliers' AND allowed = false
  AND staff_id IN (
    SELECT staff_id FROM staff_permission_overrides WHERE permission_key = 'view_products' AND allowed = true
  );

COMMIT;
