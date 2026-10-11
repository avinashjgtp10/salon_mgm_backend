-- Additive and safe to re-run. Run outside a transaction: CONCURRENTLY
-- builds the index without blocking notification inserts.
-- Serves notificationsRepository.createOnce(), which looks up an existing
-- row by (salon_id, type, reference_id, title) before every attendance and
-- break notification.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_dedupe
  ON notifications (salon_id, type, reference_id);
