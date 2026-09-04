-- Adds spotlight_feature_id to notifications so a "New Feature Added"
-- notification (spotlightService.publish's broadcast) can deep-link back to
-- the feature that triggered it — the same click-through purpose
-- product_id/alert_status already serve for inventory alerts, but that
-- column is FK'd to products(id) specifically, so a spotlight_features.id
-- can't be stored there without violating the constraint. A dedicated,
-- separately-FK'd column is simpler and safer than a generic polymorphic
-- "entity_id + entity_type" pair for what is currently exactly two use cases.
-- Run by hand against each environment — never auto-run.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS spotlight_feature_id UUID REFERENCES spotlight_features(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_spotlight_feature_id
  ON notifications(spotlight_feature_id) WHERE spotlight_feature_id IS NOT NULL;
