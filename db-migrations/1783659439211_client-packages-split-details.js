exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_packages
      ADD COLUMN IF NOT EXISTS split_details JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_packages
      DROP COLUMN IF EXISTS split_details;
  `);
};
