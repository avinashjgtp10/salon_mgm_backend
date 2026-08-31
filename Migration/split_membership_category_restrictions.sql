-- Bug: a membership plan's category restriction (e.g. "Massage" + "Nail Care")
-- was stored in ONE shared `category_ids` array used to gate BOTH service
-- items and product items. service_categories is one shared table for both
-- service and product categories (distinguished only by a `type` column:
-- 'service' | 'product' | 'both') — a category tagged 'both' (e.g. "Nail
-- Care", which has real retail products assigned to it) is a valid id on
-- EITHER side. Picking it under "Services" to restrict a plan to Massage/
-- Nail SERVICES therefore also silently made it a valid restriction id for
-- PRODUCTS in that same category, since nothing recorded which picker the
-- admin actually used it in. When applies_to = 'both' (or 'products'), the
-- discount/wallet benefit then matched retail products under "Nail Care"
-- (nail polish, manicure kits, etc.) even though the admin only ever
-- intended the Massage/Nail SERVICES to be covered.
--
-- Fix: split the single category_ids column into two independent columns —
-- service_category_ids / product_category_ids — mirroring the service_ids/
-- product_ids split that item-level restriction already uses. This lets the
-- application layer (and the picker UI) record which side each selected
-- category actually belongs to, instead of one array serving both.
--
-- Existing plans/sold memberships are backfilled from their current
-- category_ids into whichever side(s) their applies_to already allowed —
-- this reproduces their exact current (possibly over-broad) behavior rather
-- than silently re-scoping a live plan; only a plan that gets re-saved
-- through the fixed picker actually separates the two going forward. The
-- old category_ids column is left in place, unused, rather than dropped.

ALTER TABLE memberships        ADD COLUMN IF NOT EXISTS service_category_ids UUID[];
ALTER TABLE memberships        ADD COLUMN IF NOT EXISTS product_category_ids UUID[];
ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS service_category_ids UUID[];
ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS product_category_ids UUID[];

UPDATE memberships
   SET service_category_ids = category_ids
 WHERE category_ids IS NOT NULL AND applies_to IN ('services', 'both');

UPDATE memberships
   SET product_category_ids = category_ids
 WHERE category_ids IS NOT NULL AND applies_to IN ('products', 'both');

UPDATE client_memberships
   SET service_category_ids = category_ids
 WHERE category_ids IS NOT NULL AND applies_to IN ('services', 'both');

UPDATE client_memberships
   SET product_category_ids = category_ids
 WHERE category_ids IS NOT NULL AND applies_to IN ('products', 'both');
