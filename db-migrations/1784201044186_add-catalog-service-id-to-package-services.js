exports.shorthands = undefined;

// client_package_services only ever stored service_name (text) — if two
// catalog services share a display name but have different ids/prices (e.g.
// two "Hair Cut" entries), package creation and later redemption/coverage
// matching were both keyed off that name, so the wrong one could get
// consumed. This adds a real FK to the catalog so matching can be exact;
// existing rows keep catalog_service_id NULL and fall back to name-matching
// (see coveredServices in AppointmentModal.tsx) — no backfill attempted here,
// there's no reliable way to know which catalog row an old text name meant.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_package_services
      ADD COLUMN IF NOT EXISTS catalog_service_id UUID REFERENCES services(id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE client_package_services DROP COLUMN IF EXISTS catalog_service_id;
  `);
};
