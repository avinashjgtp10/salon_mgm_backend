exports.shorthands = undefined;

// Suppliers already existed as their own entity (inventory module) but were
// never linked to a product — this lets a product record which supplier it
// comes from, surfaced as a dropdown on the Create/Edit Product form.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_products_supplier_id;
    ALTER TABLE products DROP COLUMN IF EXISTS supplier_id;
  `);
};
