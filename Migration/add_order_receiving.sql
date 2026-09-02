

ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'sent'
  CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled'));

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_qty NUMERIC(12,3) NOT NULL DEFAULT 0;

-- Nullable: a Purchase can still be recorded standalone (no PO), same as
-- today, via the Product Inventory "Purchase" button / Purchase History.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);
CREATE INDEX IF NOT EXISTS idx_purchases_order ON purchases(order_id);
