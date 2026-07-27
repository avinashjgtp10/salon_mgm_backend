exports.shorthands = undefined;

// client_packages/client_memberships rows created as a byproduct of paying an
// appointment that had package_items/membership_items on it (see
// payments.service.ts's autoCreateFromPayment calls) were indistinguishable
// from a genuinely standalone "Sell Package"/"Sell Membership" purchase. The
// client stats aggregation (useClientDetails.ts) counts every row from these
// two tables as its own revenue on top of the appointment's own total, which
// already includes that same package/membership item — double-counting the
// client's total revenue for any package/membership sold via an appointment.
// This column lets that distinction be made: NULL means a genuine standalone
// sale (never otherwise counted anywhere), a real id means it was already
// counted via that appointment's total and must be excluded here.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_packages
      ADD COLUMN IF NOT EXISTS appointment_id UUID NULL REFERENCES appointments(id) ON DELETE SET NULL;
    ALTER TABLE client_memberships
      ADD COLUMN IF NOT EXISTS appointment_id UUID NULL REFERENCES appointments(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_packages DROP COLUMN IF EXISTS appointment_id;
    ALTER TABLE client_memberships DROP COLUMN IF EXISTS appointment_id;
  `);
};
