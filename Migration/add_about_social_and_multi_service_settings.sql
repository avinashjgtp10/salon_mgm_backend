-- Online Booking: About Us social links + section toggle, and the
-- "Allow Multiple Services" booking switch.
--
-- about_enabled / allow_multiple_services default TRUE so every existing salon
-- keeps behaving exactly as it does today (the About section already shows, and
-- the public booking flow has always allowed picking several services) until an
-- owner deliberately turns one off.
--
-- Reads of these are column-existence-aware (see optionalProfileColumns() in
-- bookings.repository.ts), so the public booking flow and the Marketplace
-- Profile save both work whether or not this has been run — the settings simply
-- read as their defaults until it is.
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS instagram_url           VARCHAR(255);
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS facebook_url            VARCHAR(255);
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS about_enabled           BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS allow_multiple_services BOOLEAN NOT NULL DEFAULT TRUE;
