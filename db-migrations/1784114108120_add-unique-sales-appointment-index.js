exports.shorthands = undefined;

// Turns the "check findByAppointmentId, then create if missing" pattern used
// by every sale-creation call site into a DB-enforced invariant, closing the
// check-then-act race between payments.service.ts and
// appointments.service.ts::checkout() when both fire close together.
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_appointment_unique
      ON sales (appointment_id)
      WHERE appointment_id IS NOT NULL AND status <> 'cancelled';
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    DROP INDEX CONCURRENTLY IF EXISTS idx_sales_appointment_unique;
  `);
};
