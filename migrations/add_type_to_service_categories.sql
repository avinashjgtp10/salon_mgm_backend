-- service_categories was shared between services and products with no way to
-- tell which a category was meant for — products.category_id and
-- services.category_id both point at the same table, so the Product form's
-- category picker showed every service category too (and vice versa).
--
-- Backfilled from ACTUAL usage rather than defaulted to one side: a category
-- already assigned to both services and products keeps showing in both
-- pickers ('both'), one used by only one side is tagged to that side, and a
-- category nobody has assigned yet defaults to 'both' since there's no usage
-- evidence to narrow it.
--
-- Already applied idempotently via the boot-time migration in
-- src/config/database.ts (runs on every server start) — this file is the
-- reference copy, safe to re-run by hand since every statement is guarded.

ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE service_categories c SET type = CASE
    WHEN EXISTS (SELECT 1 FROM services s WHERE s.category_id = c.id)
     AND EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id) THEN 'both'
    WHEN EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id) THEN 'product'
    WHEN EXISTS (SELECT 1 FROM services s WHERE s.category_id = c.id) THEN 'service'
    ELSE 'both'
END
WHERE c.type IS NULL;

ALTER TABLE service_categories ALTER COLUMN type SET DEFAULT 'both';
ALTER TABLE service_categories ALTER COLUMN type SET NOT NULL;
