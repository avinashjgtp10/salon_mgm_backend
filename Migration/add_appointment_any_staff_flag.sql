-- The public Online Booking "Any Available" option lets a customer skip
-- picking a specific stylist; bookingsService.createBooking already
-- auto-assigns a real, eligible, available staff member in that case (so
-- commission/schedule/staff-view logic keeps working normally) but threw away
-- the fact that the customer never expressed a stylist preference once a real
-- staff_id was picked. This flag preserves that fact so the internal Calendar
-- can show these appointments in their own dedicated "Any" column instead of
-- silently attributing them to whichever stylist auto-assignment happened to
-- pick.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_any_staff BOOLEAN NOT NULL DEFAULT false;
