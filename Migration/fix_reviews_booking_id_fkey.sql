-- reviews.booking_id has always stored an appointments.id (see
-- reviews.repository.ts upsertRatingForAppointment / reviews.service.ts
-- submitPublicFeedback), but its FK constraint points at the legacy
-- `bookings` table (0 rows — a dead pre-rename table), so every feedback
-- submission fails with a foreign key violation. Repoint it at the table
-- it actually references.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_booking_id_fkey;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES appointments(id);
