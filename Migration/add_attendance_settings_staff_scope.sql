-- Attendance Rules' "Staff-wise Application" and Half Day deduction amount were
-- being saved only to browser localStorage — attendance_settings had no columns
-- for them, so the settings PUT silently stripped these fields before persisting,
-- and the UI's "Saved" confirmation was never actually true server-side (only
-- visible again on the same browser via its localStorage mirror). Apply before
-- deploying the backend.
BEGIN;
ALTER TABLE attendance_settings ADD COLUMN IF NOT EXISTS half_day_deduction_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE attendance_settings ADD COLUMN IF NOT EXISTS staff_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE attendance_settings ADD COLUMN IF NOT EXISTS selected_staff_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
