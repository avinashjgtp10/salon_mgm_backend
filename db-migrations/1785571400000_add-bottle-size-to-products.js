exports.shorthands = undefined;

// Container-based consumable tracking: products.amount already holds the
// current remaining quantity in the product's own unit (e.g. ml) and
// qty_alert already holds a low-stock threshold — both are reused as-is.
// The one fact the system doesn't have is how much a single bottle/container
// holds, so stock quantity (bottle count) can be derived instead of stored
// and decremented directly. Nullable, no default: a product with no
// bottle_size behaves exactly as it did before this migration (plain
// unit-based stock, no container rounding).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS bottle_size NUMERIC(12,3);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE products DROP COLUMN IF EXISTS bottle_size;
  `);
};
