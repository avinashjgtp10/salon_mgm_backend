exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS stock_reconciliation (
      id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id           UUID          NOT NULL REFERENCES salons(id)    ON DELETE CASCADE,
      branch_id          UUID          NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
      product_id         UUID          NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
      adjust_stock       NUMERIC(12,2) NOT NULL DEFAULT 0,
      adjust_consumable  NUMERIC(12,2) NOT NULL DEFAULT 0,
      remark             TEXT,
      reconciled_by      UUID          REFERENCES users(id),
      created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (branch_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_recon_branch
      ON stock_reconciliation (branch_id);

    CREATE INDEX IF NOT EXISTS idx_stock_recon_product
      ON stock_reconciliation (product_id);

    CREATE TABLE IF NOT EXISTS consumable_usage (
      id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id    UUID          NOT NULL REFERENCES salons(id)   ON DELETE CASCADE,
      branch_id   UUID          NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      booking_id  UUID,
      qty         NUMERIC(10,3) NOT NULL DEFAULT 0,
      unit        VARCHAR(30),
      used_by     UUID          REFERENCES users(id),
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_consumable_usage_branch_product
      ON consumable_usage (branch_id, product_id);

    CREATE INDEX IF NOT EXISTS idx_consumable_usage_branch
      ON consumable_usage (branch_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS consumable_usage;
    DROP TABLE IF EXISTS stock_reconciliation;
  `);
};
