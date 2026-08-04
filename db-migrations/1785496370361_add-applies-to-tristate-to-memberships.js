exports.shorthands = undefined;

// Replaces the boolean `applies_to_products` (added by
// 1784215000000_add-applies-to-products-to-memberships.js) with a proper
// 3-way choice: a membership plan can now apply to services only, products
// only, or both — the boolean could only ever express "services always
// eligible, products optionally too," with no way to exclude services.
//
// Default 'services' preserves every existing plan's current behavior
// (matching the boolean's old default of false), and the backfill carries
// forward any plan that had already opted into product coverage.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships
      ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'services';

    ALTER TABLE memberships
      ADD CONSTRAINT memberships_applies_to_valid
      CHECK (applies_to IN ('services', 'products', 'both'));

    UPDATE memberships SET applies_to = 'both' WHERE applies_to_products = true;

    ALTER TABLE memberships DROP COLUMN IF EXISTS applies_to_products;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships
      ADD COLUMN IF NOT EXISTS applies_to_products BOOLEAN NOT NULL DEFAULT false;

    UPDATE memberships SET applies_to_products = true WHERE applies_to IN ('products', 'both');

    ALTER TABLE memberships
      DROP CONSTRAINT IF EXISTS memberships_applies_to_valid;

    ALTER TABLE memberships DROP COLUMN IF EXISTS applies_to;
  `);
};
