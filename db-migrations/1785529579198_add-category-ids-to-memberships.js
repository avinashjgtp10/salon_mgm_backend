exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships ADD COLUMN IF NOT EXISTS category_ids UUID[];
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships DROP COLUMN IF EXISTS category_ids;
  `);
};
