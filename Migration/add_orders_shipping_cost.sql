-- The orders table was already created (via create_orders_tables.sql) before
-- shipping_cost was added to that file for the Order Summary redesign, so the
-- CREATE TABLE IF NOT EXISTS there no-ops and never picks up the new column
-- on an existing database. This adds it directly.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment that already has the orders table.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
