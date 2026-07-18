exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_appointments_salon_status_scheduled
      ON appointments (salon_id, status, scheduled_at DESC);

    CREATE INDEX IF NOT EXISTS idx_payments_appointment_created
      ON payments (appointment_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_payments_appointment_created;
    DROP INDEX IF EXISTS idx_appointments_salon_status_scheduled;
  `);
};
