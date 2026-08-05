exports.shorthands = undefined;

// Per-appointment consumable data (the recipe copied onto a specific booking,
// plus whatever actual quantity staff record) deliberately lives in its own
// relational table rather than inside the `appointments.services` JSONB
// column that holds the rest of a service line-item. Reports like "most
// consumed products", "average usage per service", or "staff/branch
// comparison" need to GROUP BY across appointments — trivial here, painful
// against JSONB. This table is *current state* only (updated in place as
// Actual Qty is edited, same as how a row's price/qty already behave); the
// append-only deduction/return audit trail lives separately in
// consumable_usage and is never touched by edits to this table.
//
// service_row_id is not a foreign key: it addresses one item inside the
// `services` JSONB array on the appointments row, not a relational row, and
// is only unique within a single appointment (hence the composite unique
// constraint below, not a standalone unique on service_row_id).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS appointment_service_consumables (
      id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id  UUID          NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      service_row_id  TEXT          NOT NULL,
      service_id      UUID          REFERENCES services(id) ON DELETE SET NULL,
      product_id      UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      standard_qty    NUMERIC(10,3) NOT NULL,
      actual_qty      NUMERIC(10,3) NOT NULL,
      unit            VARCHAR(30),
      branch_id       UUID          REFERENCES branches(id),
      staff_id        UUID          REFERENCES users(id),
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (appointment_id, service_row_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_asc_appointment
      ON appointment_service_consumables (appointment_id);

    CREATE INDEX IF NOT EXISTS idx_asc_product
      ON appointment_service_consumables (product_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS appointment_service_consumables;
  `);
};
