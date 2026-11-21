-- Past bills ("Add Past Bill"): a Tax % on each product line.
-- purchase_items.total_price already INCLUDES the tax: quantity x purchase_price x (1 + tax_percent / 100).
-- Existing rows get 0 (no tax), so every old order and bill keeps exactly the same total.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in that order.
-- Safe to run more than once. Run it BEFORE deploying/using the backend that writes tax_percent.

BEGIN;

ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

COMMIT;
