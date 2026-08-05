exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    CREATE INDEX IF NOT EXISTS idx_products_is_active ON products (is_active);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_products_is_active;
    ALTER TABLE products DROP COLUMN IF EXISTS is_active;
  `);
};
