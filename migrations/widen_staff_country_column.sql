-- staff.country was VARCHAR(10) — far too narrow for the free-text values
-- actually being written to it (the Staff CSV import writes the "Address"
-- column here; see staff.service.ts importStaff), causing:
--   "value too long for type character varying(10)"
-- Widened to VARCHAR(255) to match every other free-text staff column
-- (designation, phone, calendar_color were already widened in
-- fix_staff_column_lengths.sql).

ALTER TABLE staff
    ALTER COLUMN country TYPE VARCHAR(255);
