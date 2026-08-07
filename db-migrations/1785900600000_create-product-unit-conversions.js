// Named-unit conversion factors for a consumable product (e.g. "Bottle" = 1000
// ml, "Sachet" = 20 ml) — display/entry only. Inventory itself always stays in
// the product's base unit (products.measure_unit / products.amount); this
// table exists purely so staff can log usage in whatever unit they actually
// hand out ("2 Sachet") and have it converted to the base unit for deduction.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS product_unit_conversions (
      id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id          UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      unit_name           VARCHAR(30)   NOT NULL,
      conversion_to_base  NUMERIC(12,4) NOT NULL CHECK (conversion_to_base > 0),
      sort_order          INT           NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (product_id, unit_name)
    );
    CREATE INDEX IF NOT EXISTS idx_puc_product ON product_unit_conversions (product_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS product_unit_conversions;`);
};
