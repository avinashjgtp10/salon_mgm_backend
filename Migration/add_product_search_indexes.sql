-- Product search / Products list indexes. Additive and safe to re-run (IF NOT EXISTS): no data or column changes,
-- indexes never change what a search returns. Per project policy NOT auto-run; apply by hand, dev -> QA -> prod.
-- No app code depends on it, so deploy order does not matter.
--
-- Already present (add_search_indexes.sql): products name / barcode trigram, salon_id, is_active, brand/category/supplier.
-- This file adds what the Products list query (productsRepository._buildFilterConditions + list) still lacked:
--
--  * The search box also matches the SUPPLIER's name through an EXISTS sub-select (suppliers.name ILIKE '%text%'),
--    which had no trigram index, so every keystroke scanned the suppliers table.
--  * The list is always "WHERE salon_id = ? AND is_active = ?" ordered by created_at (default) or name, with LIMIT/OFFSET:
--    a composite index lets Postgres read the page in order instead of sorting every product of the salon.
--
-- Needs pg_trgm (already created by add_search_indexes.sql). On a large production table run the statements with
-- CREATE INDEX CONCURRENTLY (cannot run inside BEGIN/COMMIT, hence no transaction wrapper here).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_salon_active_created
  ON products (salon_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_salon_active_name
  ON products (salon_id, is_active, name);
