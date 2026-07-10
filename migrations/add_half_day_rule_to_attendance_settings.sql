-- Owner-configurable Half Day Rule (frontend Settings > Configuration > Half Day Rule):
-- staff checking in later than shift_start + threshold_hours are marked half_day.
-- Column names match the frontend's request/response payload keys exactly, since
-- attendanceRepository.upsertSettings() builds its SQL from the request body's own keys.
ALTER TABLE attendance_settings
ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS threshold_hours NUMERIC(4,2) NOT NULL DEFAULT 2.0;
