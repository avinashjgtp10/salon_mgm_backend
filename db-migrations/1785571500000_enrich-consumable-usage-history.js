exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE consumable_usage
      ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES sales(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS remaining_stock NUMERIC(12,3),
      ADD COLUMN IF NOT EXISTS supply_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS usage_value NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS status VARCHAR(30);

    CREATE INDEX IF NOT EXISTS idx_consumable_usage_salon_created
      ON consumable_usage (salon_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_service
      ON consumable_usage (service_id);
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_staff
      ON consumable_usage (staff_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_consumable_usage_staff;
    DROP INDEX IF EXISTS idx_consumable_usage_service;
    DROP INDEX IF EXISTS idx_consumable_usage_salon_created;
    ALTER TABLE consumable_usage
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS usage_value,
      DROP COLUMN IF EXISTS supply_price,
      DROP COLUMN IF EXISTS remaining_stock,
      DROP COLUMN IF EXISTS staff_id,
      DROP COLUMN IF EXISTS invoice_id,
      DROP COLUMN IF EXISTS service_id;
  `);
};
