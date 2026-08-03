exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE consumable_usage
      ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS configured_quantity NUMERIC(10,3),
      ADD COLUMN IF NOT EXISTS notes TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE consumable_usage
      DROP COLUMN IF EXISTS notes,
      DROP COLUMN IF EXISTS configured_quantity,
      DROP COLUMN IF EXISTS is_manual;
  `);
};
