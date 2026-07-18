exports.shorthands = undefined;

// Simple single-line address on the client record — mirrors staff.address
// (a plain text column, separate from the more elaborate client_addresses
// table used by the old multi-step address wizard, which isn't part of the
// redesigned Add/Edit Client form).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS address TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients DROP COLUMN IF EXISTS address;
  `);
};
