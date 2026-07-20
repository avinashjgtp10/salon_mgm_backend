-- Adds the per-category revenue-slab threshold to staff_commission_settings.
--
-- This column was added manually against salonoxdb_dev at some point (no
-- migration file or self-healing patch ever recorded it) and is a hard
-- dependency of staffSettings.repository.ts (saving a staff member's
-- commission settings) and reports.repository.ts's Commission Report query.
-- Its absence on any other environment makes both of those fail outright with
-- "column does not exist". Confirmed missing on prod and fixed there directly;
-- this file documents the change so it's reproducible and won't silently drift
-- again on a future environment (staging, a restored backup, etc).
ALTER TABLE staff_commission_settings
  ADD COLUMN IF NOT EXISTS revenue_target NUMERIC(12,2) NOT NULL DEFAULT 0;
