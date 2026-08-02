exports.shorthands = undefined;

// Consumable configuration and appointment usage are snapshots, matching the
// existing services/product_items JSONB convention on appointments. Stock and
// usage history continue to use the existing relational audit tables.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS consumables JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS actual_consumables JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE stock_movements
      ADD COLUMN IF NOT EXISTS before_stock NUMERIC(12,3),
      ADD COLUMN IF NOT EXISTS after_stock  NUMERIC(12,3);

    CREATE INDEX IF NOT EXISTS idx_consumable_usage_booking
      ON consumable_usage (booking_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_consumable_usage_booking;
    ALTER TABLE stock_movements
      DROP COLUMN IF EXISTS before_stock,
      DROP COLUMN IF EXISTS after_stock;
    ALTER TABLE appointments DROP COLUMN IF EXISTS actual_consumables;
    ALTER TABLE services DROP COLUMN IF EXISTS consumables;
  `);
};
