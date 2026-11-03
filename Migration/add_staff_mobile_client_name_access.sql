-- Mobile app: per-staff "Client name access" switch.
--
-- The SalonOX mobile app masks client names for staff (e.g. "Pr****").
-- When this is ON, the owner lets that staff member see clients' full names
-- in the mobile app instead. OFF (the default) keeps every staff member
-- exactly as before. The web app never uses it.
--
-- Every read of this column is column-existence-aware (see
-- mobile-staff/mobileClientNameAccess.ts), so the app keeps working, with the
-- switch simply off, until this has been run. Saving the switch does need
-- it — run this before deploying the backend/mobile app.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mobile_client_name_access BOOLEAN NOT NULL DEFAULT FALSE;
