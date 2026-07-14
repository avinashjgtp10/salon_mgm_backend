-- Migration: add Create Employee page fields to staff table
-- NOT YET APPLIED — written per request but deliberately not run against the DB.
-- Run this manually against salonoxdb_dev (or via your usual migration process)
-- when ready, then let the backend repository code know so it can start writing
-- these columns (see the "Pending DB migration" comment block in
-- src/modules/staff/staff.types.ts and staff.repository.ts create()/update()).
--
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS working_hours_per_day NUMERIC(4,1);

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS holidays INTEGER;
