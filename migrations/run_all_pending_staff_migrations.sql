-- Combined migration: run all pending staff table column additions
-- Run this once against your PostgreSQL database
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS)

-- 1. password_hash (from add_password_hash_to_staff.sql)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. permission_level and allow_calendar_bookings (from add_permission_fields_to_staff.sql)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS permission_level VARCHAR(20) DEFAULT 'low';

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS allow_calendar_bookings BOOLEAN DEFAULT true;

-- 3. custom_permissions JSONB override per staff member (from add_custom_permissions_to_staff.sql)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS custom_permissions JSONB;
