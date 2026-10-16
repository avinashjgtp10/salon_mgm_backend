-- "Manage My Brands" now depends on "View Products".
--
-- Expected behaviour (Products permissions ticket):
--   * View Products OFF  -> Manage My Brands is disabled (greyed out, reads OFF).
--   * View Products ON   -> Manage My Brands becomes available again.
--   * Turning View Products OFF after Manage My Brands was enabled switches it OFF too.
--   * The brand write routes (POST/PATCH/DELETE /products/brands) also require View Products
--     server-side, so a direct API call cannot bypass the editor.
--
-- The editor side (lock + force-off) lives in the frontend's permissionCascade.ts; this file
-- declares the dependency in the permission catalog so the editors' "turn the prerequisite on
-- with it" and "refuse to save without the prerequisite" rules apply, and cleans up grants that
-- already break the rule.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each
-- environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET depends_on = ARRAY['view_products'] WHERE key = 'manage_my_brands';

-- Backfill: a role that has Manage My Brands but not View Products loses Manage My Brands
-- (the reverse of the View Suppliers backfill — turning a permission OFF here is deliberate, it
-- is exactly what the rule says should have happened when View Products was switched off).
UPDATE role_permissions SET allowed = false
WHERE permission_key = 'manage_my_brands' AND allowed = true
  AND role_id NOT IN (
    SELECT role_id FROM role_permissions WHERE permission_key = 'view_products' AND allowed = true
  );

-- Same for per-staff overrides.
UPDATE staff_permission_overrides SET allowed = false
WHERE permission_key = 'manage_my_brands' AND allowed = true
  AND staff_id NOT IN (
    SELECT staff_id FROM staff_permission_overrides WHERE permission_key = 'view_products' AND allowed = true
  );

COMMIT;
