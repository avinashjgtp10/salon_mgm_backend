-- Per-staff "Show in Online Booking" toggle (Marketplace Profile > Staff
-- Visibility). Independent of allow_calendar_bookings, which controls
-- whether a staff member gets a column in the internal Calendar — the two
-- must not be conflated (ticket explicitly requires this setting not affect
-- Calendar or other staff functionality). Defaults true so every existing
-- active staff member keeps showing on the public booking page unchanged.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS show_in_online_booking BOOLEAN NOT NULL DEFAULT true;
