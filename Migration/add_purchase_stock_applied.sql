-- Supplier "Add Past Bill (no stock change)": records an OLD supplier bill (supplier + products + amounts) WITHOUT touching product stock,
-- stock_movements or stock_ledger. Used when the stock was already corrected by hand in the catalog and the bill only needs to be on record.
--
-- stock_applied: TRUE  = normal purchase / order receipt (stock was increased)  <- every existing row, and the default
--                FALSE = historical bill (stock was NOT changed)
-- bill_number / notes: optional details typed on the Past Bill form (the supplier's own invoice number, a free note).
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in that order.
-- Safe to run more than once. Run it BEFORE using the new POST /product-inventory/purchases/historical endpoint.

BEGIN;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stock_applied BOOLEAN       NOT NULL DEFAULT TRUE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS bill_number   VARCHAR(60);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS notes         TEXT;

COMMIT;
