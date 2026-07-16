-- Migration: add Create Employee page fields to staff table
-- Superseded by db-migrations/1784106508184_add-employee-profile-fields-to-staff.js,
-- which node-pg-migrate applies via `npm run migrate:up`. This file is kept only
-- as historical reference — run the db-migrations version, not this one.
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
