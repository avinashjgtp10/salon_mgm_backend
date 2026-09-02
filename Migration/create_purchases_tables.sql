
CREATE TABLE IF NOT EXISTS purchases (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL,
  supplier_id       UUID          NOT NULL REFERENCES suppliers(id),
  purchase_number   VARCHAR(20)   NOT NULL,
  purchase_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by        UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, purchase_number)
);
CREATE INDEX IF NOT EXISTS idx_purchases_salon ON purchases(salon_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id       UUID          NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id        UUID          NOT NULL REFERENCES products(id),
  quantity          NUMERIC(12,3) NOT NULL,
  purchase_price    NUMERIC(12,2) NOT NULL,
  total_price       NUMERIC(12,2) NOT NULL,
  expiry_date       DATE,
  stock_movement_id UUID REFERENCES stock_movements(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_expiry ON purchase_items(product_id, expiry_date);

ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_purchase_seq INT NOT NULL DEFAULT 1;
