-- Run before deploying the Dashboard guide API. No records for untouched guides.
ALTER TABLE users ADD COLUMN IF NOT EXISTS guide_progress JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Rollback (discards saved guide progress):
-- ALTER TABLE users DROP COLUMN guide_progress;
