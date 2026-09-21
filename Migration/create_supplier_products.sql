-- Supplier Products Catalog: a supplier's Excel/CSV product list, imported
-- and matched against the salon's own `products` table where possible.
-- Mirrors supplier_payments' shape (see Migration/add_supplier_payments.sql).
-- product_id is nullable — only set once a row is matched (on import) or
-- resolved by hand (link/create_product). No unique constraint on the
-- matching fields — dedupe on re-import is application-level (prefetch-all-
-- then-match-in-memory, same pattern as products.import.ts), not a DB one.

CREATE TABLE IF NOT EXISTS supplier_products (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id        UUID          NOT NULL,
  supplier_id     UUID          NOT NULL REFERENCES suppliers(id),
  product_id      UUID          REFERENCES products(id),
  name            TEXT          NOT NULL,
  barcode         TEXT,
  brand_id        UUID          REFERENCES product_brands(id),
  category_id     UUID          REFERENCES service_categories(id),
  -- Supplier's own item code from their sheet — external-only, meaningful
  -- just within that supplier's own catalog, used purely to re-identify a
  -- row on a later re-import (never matched against products.*).
  supplier_sku    TEXT,
  price           NUMERIC(12,2),
  hsn_sac         TEXT,
  match_status    VARCHAR(20)   NOT NULL DEFAULT 'unmatched'
                  CHECK (match_status IN ('matched', 'unmatched')),
  -- Set via the Ignore resolve action — hides a row from Suggested
  -- Products without linking or creating a product for it.
  ignored         BOOLEAN       NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_products_salon ON supplier_products(salon_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
