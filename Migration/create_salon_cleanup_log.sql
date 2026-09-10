-- Super Admin "Clean Up Account History": clearSalonData (Data Cleanup page's
-- "Clear All Data" action) currently has no logging at all — this table
-- captures who cleared which salon's data and when. Mirrors deleted_account_log's
-- shape/conventions (see create_deleted_account_log.sql).

CREATE TABLE IF NOT EXISTS salon_cleanup_log (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL,
  salon_name        VARCHAR(255),
  cleared_by        UUID          NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_cleanup_log_created_at ON salon_cleanup_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_salon_cleanup_log_salon_id ON salon_cleanup_log(salon_id);
