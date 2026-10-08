-- Mobile app: per-staff "Calendar & Quick Sale access" switch.
--
-- When ON, the staff member can book and bill Quick Sales from the Calendar
-- in the SalonOX mobile app, even without the matching Roles & Permissions
-- grants. It applies only to requests sent by the mobile app
-- (X-Salonox-Client: mobile) — the web app keeps using Roles & Permissions
-- alone, so turning this on changes nothing there. OFF (the default) keeps
-- every staff member exactly as before.
--
-- Every read of this column is column-existence-aware (see
-- mobile-staff/mobileCalendarAccess.ts), so permission checks keep working,
-- with the switch simply off, until this has been run. Saving the switch
-- does need it — run this before deploying the backend/mobile app.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mobile_calendar_access BOOLEAN NOT NULL DEFAULT FALSE;
