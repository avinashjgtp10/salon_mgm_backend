exports.shorthands = undefined;

// Memberships were services-only: wallet redemption always drew only from
// appt.services, never appt.product_items. This flag lets a membership plan
// opt in to also covering products with the same pooled wallet balance —
// default false so every existing membership keeps today's behavior.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships
      ADD COLUMN IF NOT EXISTS applies_to_products BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships DROP COLUMN IF EXISTS applies_to_products;
  `);
};
