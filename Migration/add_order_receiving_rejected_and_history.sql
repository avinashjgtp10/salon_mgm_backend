-- Receive Order redesign: rejected quantities + per-delivery receiving history.
--
-- * order_items.rejected_qty — units that arrived but were refused (wrong item,
--   spoiled, etc). Like damaged_qty they are NEVER added to products.amount, and
--   they count as "accounted for" so they stop showing as pending.
-- * order_receiving_log / order_receiving_log_items — one row per Receive click
--   (a delivery), with the notes typed for it and the per-line received /
--   damaged / rejected split. The stock itself is still written only by
--   purchasesRepository.create() (purchases + stock_movements + stock_ledger);
--   purchase_id links this log back to that Purchase.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(12,3) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_receiving_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     UUID        NOT NULL,
  order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- NULL when the delivery was damaged/rejected-only (no stock came in).
  purchase_id  UUID        REFERENCES purchases(id) ON DELETE SET NULL,
  received_by  UUID,
  notes        TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_receiving_log_order ON order_receiving_log(order_id, created_at);

CREATE TABLE IF NOT EXISTS order_receiving_log_items (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id         UUID          NOT NULL REFERENCES order_receiving_log(id) ON DELETE CASCADE,
  order_item_id  UUID          REFERENCES order_items(id) ON DELETE SET NULL,
  product_id     UUID          NOT NULL,
  product_name   TEXT,
  received_qty   NUMERIC(12,3) NOT NULL DEFAULT 0,
  damaged_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
  rejected_qty   NUMERIC(12,3) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_receiving_log_items_log ON order_receiving_log_items(log_id);
