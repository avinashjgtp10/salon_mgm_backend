-- Booking Settings gains an "Allow Same-Day Booking" switch: when a salon turns
-- it off, today's date stops offering bookable slots online (tomorrow onward is
-- unaffected, and appointments already on the books are never touched).
--
-- Defaults to TRUE so every existing salon keeps its current behaviour — today
-- stays bookable until an owner deliberately turns it off.
--
-- Reads and writes of this column are wrapped to tolerate its absence (Postgres
-- 42703), matching the other booking-policy columns, so the public booking flow
-- and the Marketplace Profile save button both work whether or not this has
-- been run. Until it is, the setting simply reads as ON.
ALTER TABLE marketplace_profiles
  ADD COLUMN IF NOT EXISTS allow_same_day_booking BOOLEAN NOT NULL DEFAULT TRUE;
