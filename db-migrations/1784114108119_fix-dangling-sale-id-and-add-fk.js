exports.shorthands = undefined;

// Clears any appointments.sale_id that points at a sales row which no longer
// exists (hard-deleting a sale never cleared the appointment's reference),
// then adds a real FK so this can't happen silently again.
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE appointments
    SET sale_id = NULL
    WHERE sale_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sales WHERE sales.id = appointments.sale_id);
  `);
  pgm.sql(`
    ALTER TABLE appointments
      ADD CONSTRAINT fk_appointments_sale_id
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointments
      DROP CONSTRAINT IF EXISTS fk_appointments_sale_id;
  `);
};
