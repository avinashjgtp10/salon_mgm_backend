-- Adds source-entity linkage + dedupe support to notifications, needed for
-- inventory alerts (low stock / out of stock / expiring soon / expired).
-- product_id + alert_status identify WHICH ongoing alert a notification
-- represents; branch_id lets the click-through target a specific branch.
-- resolved_at marks when the underlying condition stopped applying (stock
-- replenished above threshold, expired batch written off, etc) — while
-- resolved_at IS NULL the alert is "still active" and the partial unique
-- index below blocks a second active notification for the same
-- product+alert_status from being created (inventoryAlertsService upserts
-- instead of re-inserting). Once resolved, a later re-trigger of the same
-- status is a fresh row (new id, new resolved_at = NULL), so history isn't
-- lost and the bell/list still shows the earlier one as a normal past item.
-- Run by hand against each environment — never auto-run.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS alert_status VARCHAR(20)
    CHECK (alert_status IN ('low_stock', 'out_of_stock', 'expiring_soon', 'expired')),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_active_inventory_alert
  ON notifications (product_id, alert_status)
  WHERE resolved_at IS NULL AND product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_product_id ON notifications(product_id) WHERE product_id IS NOT NULL;
