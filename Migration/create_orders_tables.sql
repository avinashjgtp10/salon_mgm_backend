-- Purchase Orders: a standalone document recorded before goods are received —
-- deliberately separate from `purchases` (which records stock ALREADY added,
-- see create_purchases_tables.sql). Creating an order here never touches
-- products.amount or stock_movements; it's just a document (header + line
-- items) with its own sequential order_number, mirroring the purchase_number
-- pattern via salons.next_order_seq. No draft/ordered/received lifecycle and
-- no link back to `purchases` in this phase — see NewOrderPage's Order tab;
-- the sibling "Purchase" tab (recording an actual delivery) is out of scope
-- for this feature and unaffected by these tables.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment before using the orders module.

CREATE TABLE IF NOT EXISTS orders (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID          NOT NULL,
  order_number          VARCHAR(20)   NOT NULL,
  supplier_id           UUID          NOT NULL REFERENCES suppliers(id),
  bill_to_branch_id     UUID          REFERENCES branches(id),
  ship_to_branch_id     UUID          REFERENCES branches(id),
  order_date            DATE          NOT NULL DEFAULT CURRENT_DATE,
  remark                TEXT,
  ref_number            VARCHAR(50),
  payment_terms_days    INT,
  shipment_date         DATE,
  delivery_date         DATE,
  tax_type              VARCHAR(10)   NOT NULL DEFAULT 'exclusive' CHECK (tax_type IN ('inclusive', 'exclusive')),
  tax_group             VARCHAR(100),
  terms_conditions      TEXT,
  signature_url         TEXT,
  total_quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by            UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_orders_salon ON orders(salon_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);

CREATE TABLE IF NOT EXISTS order_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            UUID          NOT NULL REFERENCES products(id),
  product_code          VARCHAR(100),
  qty                   NUMERIC(12,3) NOT NULL,
  selling_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  cost_price            NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_wo_tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost_wo_tax     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- "Gallery" for the Signature field — every image a salon has uploaded as an
-- order signature, so it can be picked again on a later order instead of
-- re-uploading. Deliberately not reusing marketplace image tables — those are
-- marketplace-listing-scoped, not a generic per-salon upload log.
CREATE TABLE IF NOT EXISTS order_signatures (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID          NOT NULL,
  url                   TEXT          NOT NULL,
  created_by            UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_signatures_salon ON order_signatures(salon_id);

ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_order_seq INT NOT NULL DEFAULT 1;
