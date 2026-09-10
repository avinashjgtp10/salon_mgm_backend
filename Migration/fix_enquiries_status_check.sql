-- The app (EnquiryReport, EnquiriesListPage status filter) added "Contacted"
-- and "Lost" to the enquiry status vocabulary, but this DB constraint was
-- never updated to match — any create/update using those two values fails
-- with "violates check constraint enquiries_status_check".
ALTER TABLE enquiries DROP CONSTRAINT enquiries_status_check;

ALTER TABLE enquiries ADD CONSTRAINT enquiries_status_check
  CHECK (status = ANY (ARRAY['New'::text, 'Contacted'::text, 'Follow-up'::text, 'Converted'::text, 'Lost'::text, 'Closed'::text]));
