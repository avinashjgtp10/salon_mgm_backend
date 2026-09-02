-- Same class of bug as reviews_booking_id_fkey (fix_reviews_booking_id_fkey.sql):
-- review_service_ratings.staff_id always stores a staff.id (see
-- reviews.repository.ts upsertServiceRatings, fed from appointments.services[].staff_id),
-- but its FK constraint points at `users`, not `staff` — every feedback
-- submission with a staffed service fails with a foreign key violation.
ALTER TABLE review_service_ratings DROP CONSTRAINT IF EXISTS review_service_ratings_staff_id_fkey;

ALTER TABLE review_service_ratings
  ADD CONSTRAINT review_service_ratings_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES staff(id);
