exports.shorthands = undefined;

// A service (e.g. "Hair Coloring") can declare the consumable products it
// uses by default (Hair Color 60ml, Developer 60ml, Shampoo 10ml) — the
// frontend's ConsumablesTab has sent this as `consumables_used` on service
// create/update for a while, but nothing ever persisted it. This junction
// table is the missing other half; a relational structure (not a JSON blob
// on `services`) so per-product usage can be joined/aggregated cleanly.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS service_consumables (
      id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      service_id  UUID          NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty         NUMERIC(10,3) NOT NULL DEFAULT 0,
      unit        VARCHAR(30),
      sort_order  INT           NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_service_consumables_service
      ON service_consumables (service_id);

    CREATE INDEX IF NOT EXISTS idx_service_consumables_product
      ON service_consumables (product_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS service_consumables;
  `);
};
