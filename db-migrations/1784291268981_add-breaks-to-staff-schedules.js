exports.shorthands = undefined;

// The "Breaks & Lunches" UI on a shift (ShiftDrawer.tsx) had nowhere to
// persist its data — staff_schedules never had a column for it, so breaks
// were silently dropped on save and never redisplayed on edit. Stored as
// jsonb (array of { start_time, end_time } in 24h "HH:MM" strings) since a
// shift can have zero to many custom breaks.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff_schedules ADD COLUMN IF NOT EXISTS breaks JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff_schedules DROP COLUMN IF EXISTS breaks;
  `);
};
