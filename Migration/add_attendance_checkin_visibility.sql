-- Attendance: "Show only checked-in staff" switch.
--
-- When ON for a salon, staff who haven't checked in today are hidden from the
-- Calendar columns, the Quick Sale / appointment stylist pickers and today's
-- online-booking slots. OFF (the default) keeps every active staff member
-- visible regardless of check-in, exactly as before — so no existing salon
-- changes behaviour until an owner deliberately turns it on.
--
-- Every read of this column is column-existence-aware (see
-- attendanceRepository.isCheckinVisibilityEnabled), so the Calendar and the
-- public booking flow keep working, with the feature simply off, until this
-- has been run.
ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS require_checkin_for_visibility BOOLEAN NOT NULL DEFAULT FALSE;
