-- Low Stock Alert now uses the same structure as Available Stock:
--   Product Quantity (products.qty_alert, unchanged)
--   × Unit Size      (products.qty_alert_unit_size, NEW)
--   Unit             (the product's own measure_unit)
-- Low Stock Threshold (base units) = qty_alert × qty_alert_unit_size.
--
-- NULL means "use the product's own bottle_size" — i.e. every product saved
-- before this keeps exactly the meaning it has today, so there is no backfill.
--
-- Every read of this column is column-existence-aware (see
-- modules/inventory/low-stock.sql.ts), so low-stock checks keep working,
-- on the old rule, until this has been run. Saving a product WITH an alert
-- unit size does need it — run this before deploying the backend/frontend.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS qty_alert_unit_size NUMERIC;
