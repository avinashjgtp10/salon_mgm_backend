exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS address TEXT;

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS avatar_url TEXT;

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS working_hours_per_day NUMERIC(4,1);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS holidays INTEGER;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff DROP COLUMN IF EXISTS gender;
    ALTER TABLE staff DROP COLUMN IF EXISTS address;
    ALTER TABLE staff DROP COLUMN IF EXISTS avatar_url;
    ALTER TABLE staff DROP COLUMN IF EXISTS working_hours_per_day;
    ALTER TABLE staff DROP COLUMN IF EXISTS holidays;
  `);
};
