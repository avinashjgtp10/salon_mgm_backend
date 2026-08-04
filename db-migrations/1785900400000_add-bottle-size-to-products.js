exports.shorthands = undefined;

// Opt-in bottle-based stock tracking: products.amount is (and already was,
// for the consumable-deduction engine's purposes) the canonical REMAINING
// VOLUME in the recipe's consumption unit (e.g. ml) — the gap was that nothing
// related that volume back to a countable "how many bottles is that" figure.
// bottle_size (nullable — most products don't use this pattern) is "how many
// consumption units are in one bottle". Where it's set, Stock Quantity
// becomes a DERIVED display value (CEIL(amount / bottle_size)), computed at
// the Stock Reconciliation query — amount itself, and the deduction engine
// that already writes to it, are unchanged.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS bottle_size NUMERIC(10,3) NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE products DROP COLUMN IF EXISTS bottle_size;
  `);
};
