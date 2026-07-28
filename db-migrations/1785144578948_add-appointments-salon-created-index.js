exports.shorthands = undefined;

// appointmentsRepository.findById() computes invoice_number via a correlated
// subquery comparing every other appointment in the same salon by
// (created_at, id) — with no supporting index this degrades into an
// effectively sequential scan per call, and findById() runs on every single
// appointment update (plus twice on a reschedule), so update latency grows
// with a salon's appointment history. This index gives that comparison a
// direct route instead of a scan.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_appointments_salon_created_id
      ON appointments (salon_id, created_at, id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_appointments_salon_created_id;
  `);
};
