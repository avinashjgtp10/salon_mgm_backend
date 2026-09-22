-- Multi-supplier pricing per product: one product can now be sourced from
-- several suppliers, each with their own SKU and price (e.g. "Hair
-- Developer 6%" from both ABC Cosmetics at 390 and Wella at 410).
-- products.supplier_id/supply_price are LEFT UNTOUCHED and keep meaning
-- "the preferred/default supplier" for every existing reader of those
-- columns (Product Inventory list, Orders, Purchases) — this table is
-- additive, not a replacement.

CREATE TABLE IF NOT EXISTS product_suppliers (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id        UUID          NOT NULL,
  product_id      UUID          NOT NULL REFERENCES products(id),
  supplier_id     UUID          NOT NULL REFERENCES suppliers(id),
  supplier_sku    TEXT,
  price           NUMERIC(12,2),
  is_preferred    BOOLEAN       NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id);

-- Backfill: every product's existing single supplier becomes its preferred
-- entry, so the new Suppliers list on the drawer isn't empty on day one.
INSERT INTO product_suppliers (salon_id, product_id, supplier_id, price, is_preferred)
SELECT salon_id, id, supplier_id, supply_price, true
  FROM products
 WHERE supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;
