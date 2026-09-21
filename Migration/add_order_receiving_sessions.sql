-- Receiving sessions for Orders (Purchase Orders): replaces the old
-- single-shot "Receive" action with a draft -> confirm workflow, mirroring
-- product_audits/product_audit_items (see create_product_audits_tables.sql).
-- A receipt lets a clerk enter Confirmed/Damaged quantities per line, pick a
-- Receiving Location (branch) and Received By (staff), and Save Draft with
-- zero stock effect. Only confirmReceipt() (order-receipts.repository.ts)
-- moves stock, via the existing purchasesRepository.create() path.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS damaged_qty NUMERIC(12,3) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_receipts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL,
  order_id          UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  branch_id         UUID          REFERENCES branches(id),
  -- Staff who physically received the delivery — distinct from created_by
  -- (whoever is filling in / confirming the receipt in the app), same
  -- "auditor_id vs current user" split as product_audits.
  received_by       UUID,
  status            VARCHAR(20)   NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'confirmed')),
  created_by        UUID,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_receipts_order ON order_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_order_receipts_status ON order_receipts(order_id, status);

CREATE TABLE IF NOT EXISTS order_receipt_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_receipt_id  UUID          NOT NULL REFERENCES order_receipts(id) ON DELETE CASCADE,
  order_item_id     UUID          NOT NULL REFERENCES order_items(id),
  product_id        UUID          NOT NULL REFERENCES products(id),
  -- Absolute cumulative targets (not deltas) — same "absolute, not delta"
  -- safety principle as product_audit_items.physical_qty: confirmReceipt()
  -- computes the delta against order_items.received_qty/damaged_qty at
  -- confirm time, so a stale draft can never silently misapply.
  confirmed_qty     NUMERIC(12,3) NOT NULL DEFAULT 0,
  damaged_qty       NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (order_receipt_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_order_receipt_items_receipt ON order_receipt_items(order_receipt_id);
