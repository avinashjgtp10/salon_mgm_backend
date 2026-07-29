ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NOT NULL DEFAULT 'retail';

ALTER TABLE products
  ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('retail', 'consumable', 'both'));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_measure_unit_check;

ALTER TABLE products
  ADD CONSTRAINT products_measure_unit_check
  CHECK (measure_unit IN ('ml', 'l', 'g', 'kg', 'pcs', 'oz', 'lb', 'bottle', 'tube', 'pack', 'box', 'roll'));

CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
