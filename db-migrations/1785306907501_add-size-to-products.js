exports.shorthands = undefined;

// Package size (e.g. "100 ml", "250 g") is distinct from `amount` (stock
// count) and `measure_unit` (the unit used for consumable deduction math) —
// this is just a free-text label combining a number the user types with the
// unit they picked, for display on the product ("100 ml" bottle).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS size VARCHAR(30);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE products DROP COLUMN IF EXISTS size;
  `);
};
