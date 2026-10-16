-- Booking IDs that start at 1.
--
-- Until now a booking's visible ID was derived from its UUID ("#BK" + the first 8 hex characters),
-- so it started with an arbitrary character and was meaningless to read out. Every NEW appointment
-- now also gets a booking_number: 1, 2, 3 ... counted per salon, assigned atomically at creation
-- (see appointments.repository.ts / bookings.repository.ts) and unique within the salon.
--
-- Existing appointments keep booking_number = NULL (they are not renumbered); the apps fall back to
-- the old UUID-derived label for them, so nothing already issued to a customer changes.
--
-- salon_booking_counters holds the last number handed out per salon. The INSERT ... ON CONFLICT
-- DO UPDATE ... RETURNING in the create queries takes the row lock, so two bookings created at the
-- same moment can never receive the same number.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each
-- environment (dev/QA/prod) in that order, BEFORE deploying the matching backend code.

BEGIN;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_number integer;

CREATE TABLE IF NOT EXISTS salon_booking_counters (
  salon_id    uuid PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_salon_booking_number
  ON appointments (salon_id, booking_number)
  WHERE booking_number IS NOT NULL;

COMMIT;
