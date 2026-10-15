-- Guided tours no longer save any progress (the web app now treats a tour as a
-- view-only walkthrough, and the /api/v1/user-guide endpoints were removed), so
-- the users.guide_progress column that stored "completed / skipped" per tour is
-- unused. Created by add_user_guide_progress.sql.
-- Per project policy this file is created but NOT auto-run; apply by hand.
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS guide_progress;
COMMIT;

-- Rollback:
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS guide_progress JSONB NOT NULL DEFAULT '{}'::jsonb;
