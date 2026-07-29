exports.shorthands = undefined;

// Products previously had no concept of Retail vs Consumable — every row was
// implicitly retail. This adds `product_type` so a product can be flagged as
// consumable (back-bar stock used up by services) or both, which the
// frontend's Consumables Used / product-type filter UI already sends but the
// column didn't exist for. `measure_unit`'s existing allowed values are also
// widened here to cover consumable-style units (bottle/tube/pack/box/roll)
// on top of the pre-existing ml/l/g/kg/pcs/oz/lb.
exports.up = (pgm) => {
  pgm.sql(`
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
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_products_product_type;

    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_measure_unit_check;
    ALTER TABLE products
      ADD CONSTRAINT products_measure_unit_check
      CHECK (measure_unit IN ('ml', 'l', 'g', 'kg', 'pcs', 'oz', 'lb'));

    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
    ALTER TABLE products DROP COLUMN IF EXISTS product_type;
  `);
};
