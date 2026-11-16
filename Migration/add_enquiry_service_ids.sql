-- An enquiry can be about several services. service_ids holds all of them; service_id stays as the first one so reports and older
-- screens keep working. The backend also adds this column by itself on first use, so running this by hand is optional. Safe to re-run.
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS service_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE enquiries SET service_ids = ARRAY[service_id] WHERE service_id IS NOT NULL AND cardinality(service_ids) = 0;
