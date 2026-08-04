-- 1. product_type: retail / consumable / both
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NOT NULL DEFAULT 'retail';

ALTER TABLE products
  ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('retail', 'consumable', 'both'));

-- Widen measure_unit to include consumable-style units
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_measure_unit_check;

ALTER TABLE products
  ADD CONSTRAINT products_measure_unit_check
  CHECK (measure_unit IN ('ml', 'l', 'g', 'kg', 'pcs', 'oz', 'lb', 'bottle', 'tube', 'pack', 'box', 'roll'));

CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);

-- 2. hsn_sac: HSN/SAC tax classification code (required for Indian GST invoices)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(20);

-- 3. supplier_id: link product to a supplier
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);

-- 4. size: free-text package size label (e.g. "100 ml", "250 g")
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size VARCHAR(30);
