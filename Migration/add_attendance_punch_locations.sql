-- Separate locations for each attendance punch. Apply before deploying the backend.
-- Safe to run whether or not the earlier single-location migration was applied.
-- Preserve any legacy location column unchanged: its value cannot reliably be
-- attributed to either punch, so do not copy it into the new fields.
BEGIN;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_location TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_location TEXT;
COMMIT;