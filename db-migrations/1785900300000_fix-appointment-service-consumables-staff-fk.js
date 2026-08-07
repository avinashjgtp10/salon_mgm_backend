exports.shorthands = undefined;

// Bug fix: appointment_service_consumables.staff_id was created referencing
// users(id) — copy-pasted from consumable_usage.used_by, which legitimately
// IS a users.id (the API caller). staff_id here means something different:
// the service row's assigned staff member, which is a staff.id — a
// completely separate id space in this schema (staff.user_id is an
// optional, often-null link to a users row, not staff.id itself). Any
// appointment save whose service row had both an assigned staff member and
// a consumable failed with a foreign key violation because of this.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointment_service_consumables
      DROP CONSTRAINT IF EXISTS appointment_service_consumables_staff_id_fkey;
    ALTER TABLE appointment_service_consumables
      ADD CONSTRAINT appointment_service_consumables_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointment_service_consumables
      DROP CONSTRAINT IF EXISTS appointment_service_consumables_staff_id_fkey;
    ALTER TABLE appointment_service_consumables
      ADD CONSTRAINT appointment_service_consumables_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES users(id);
  `);
};
