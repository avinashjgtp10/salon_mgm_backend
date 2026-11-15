-- Speeds up the Quick Sale / Calendar / Clients / Products searches. Additive and safe to re-run (IF NOT EXISTS): no data or
-- column changes, and indexes never change what a search returns.
-- Per project policy NOT auto-run; apply by hand, dev -> QA -> prod. No app code depends on it, so deploy order does not matter.
--
-- Notes
--  * Part 2 needs the pg_trgm extension. On AWS RDS this is allowed for the rds_superuser / database owner; if CREATE EXTENSION
--    is refused, parts 1 still apply and part 3 can wait until it is permitted.
--  * A plain CREATE INDEX blocks WRITES to that table while it builds. Fine on small tables (dev/QA). On a large production
--    table, run the same statements with CREATE INDEX CONCURRENTLY instead (that form cannot run inside BEGIN/COMMIT,
--    which is why this file has no transaction wrapper).

-- 1. services: only the primary key existed, so every search scanned every salon's rows.
CREATE INDEX IF NOT EXISTS idx_services_salon_id      ON services (salon_id);
CREATE INDEX IF NOT EXISTS idx_services_salon_name    ON services (salon_id, lower(name));

-- 2. Trigram support: lets a normal index serve ILIKE '%text%' (text anywhere in the value).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 3. The searches that still hit the database per query.
CREATE INDEX IF NOT EXISTS idx_products_name_trgm     ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm  ON products USING gin (barcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_full_name_trgm ON clients  USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm     ON clients  USING gin (phone_number gin_trgm_ops);
