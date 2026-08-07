exports.shorthands = undefined;

// consumable_usage was, until now, written only by the standalone manual
// "Update Consumable Items" endpoint (POST /inventory/consumable-usage) —
// always a deduction, always ad hoc, never linked to a specific service line
// item. It's about to gain a second writer: appointment completion/edit,
// which needs to (a) record returns as well as deductions when Actual Qty is
// reduced on an already-paid appointment, (b) know which service row within
// a multi-service appointment a row belongs to, and (c) distinguish its own
// rows from the pre-existing manual ones in reports. Pre-existing rows are
// backfilled to source='manual' so nothing reads back an ambiguous NULL.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS service_row_id TEXT NULL;
    ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS service_id UUID NULL REFERENCES services(id) ON DELETE SET NULL;
    ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'deduct';
    ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS source VARCHAR(30) NULL;

    UPDATE consumable_usage SET source = 'manual' WHERE source IS NULL;
  `);

  pgm.sql(`
    ALTER TABLE consumable_usage DROP CONSTRAINT IF EXISTS chk_consumable_usage_direction;
    ALTER TABLE consumable_usage ADD CONSTRAINT chk_consumable_usage_direction CHECK (direction IN ('deduct', 'return'));
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_booking ON consumable_usage (booking_id);
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_service_row ON consumable_usage (booking_id, service_row_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_consumable_usage_service_row;
    DROP INDEX IF EXISTS idx_consumable_usage_booking;
    ALTER TABLE consumable_usage DROP CONSTRAINT IF EXISTS chk_consumable_usage_direction;
    ALTER TABLE consumable_usage DROP COLUMN IF EXISTS source;
    ALTER TABLE consumable_usage DROP COLUMN IF EXISTS direction;
    ALTER TABLE consumable_usage DROP COLUMN IF EXISTS service_id;
    ALTER TABLE consumable_usage DROP COLUMN IF EXISTS service_row_id;
  `);
};
