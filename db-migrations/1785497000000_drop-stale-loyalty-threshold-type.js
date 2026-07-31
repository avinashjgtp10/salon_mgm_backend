exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_loyalty_threshold_type_valid;
    ALTER TABLE memberships DROP COLUMN IF EXISTS loyalty_threshold_type;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships ADD COLUMN IF NOT EXISTS loyalty_threshold_type VARCHAR(10);
    ALTER TABLE memberships
      ADD CONSTRAINT memberships_loyalty_threshold_type_valid
      CHECK (loyalty_threshold_type IS NULL OR loyalty_threshold_type IN ('visits', 'days'));
  `);
};
