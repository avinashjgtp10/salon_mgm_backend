-- Public Online Booking creates appointments through
-- bookingsRepository.createAppointment(), which never set `source` and so
-- silently fell through to the column default of 'calendar' — indistinguishable
-- from a staff-created calendar appointment. Add 'online_booking' as a third
-- allowed value so the app can tag these correctly; existing rows are left as
-- they are (this only widens what future rows may contain).

ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;

ALTER TABLE appointments ADD CONSTRAINT appointments_source_check
    CHECK (source::text = ANY (ARRAY['calendar', 'quick_sale', 'online_booking']::text[]));
