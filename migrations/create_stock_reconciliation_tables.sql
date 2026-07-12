-- ─── Stock Reconciliation ────────────────────────────────────────────────────
-- Stores per-product adjust_stock / adjust_consumable / remark set by the user
-- on the Stock Reconciliation page.
-- UNIQUE(branch_id, product_id) ensures one row per product per branch.

CREATE TABLE IF NOT EXISTS stock_reconciliation (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id           UUID        NOT NULL REFERENCES salons(id)    ON DELETE CASCADE,
  branch_id          UUID        NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
  product_id         UUID        NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  adjust_stock       NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjust_consumable  NUMERIC(12,2) NOT NULL DEFAULT 0,
  remark             TEXT,
  reconciled_by      UUID        REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_recon_branch
  ON stock_reconciliation (branch_id);

CREATE INDEX IF NOT EXISTS idx_stock_recon_product
  ON stock_reconciliation (product_id);


-- ─── Consumable Usage ────────────────────────────────────────────────────────
-- Records every time a product is used as a consumable during an appointment.
-- The Stock Reconciliation page aggregates these rows to compute actual_consumable.

CREATE TABLE IF NOT EXISTS consumable_usage (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES salons(id)   ON DELETE CASCADE,
  branch_id   UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  booking_id  UUID,
  qty         NUMERIC(10,3) NOT NULL DEFAULT 0,
  unit        VARCHAR(30),
  used_by     UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumable_usage_branch_product
  ON consumable_usage (branch_id, product_id);

CREATE INDEX IF NOT EXISTS idx_consumable_usage_branch
  ON consumable_usage (branch_id);
