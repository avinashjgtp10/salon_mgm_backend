-- Speeds up the Add Client duplicate-phone/duplicate-email checks
-- (clientsRepository.findActiveByPhone/findActiveByEmail/findActiveByPhoneOrEmail)
-- at scale.
--
-- This DB already has two unique indexes enforcing these at the constraint
-- level (confirmed live via pg_indexes, neither is checked into a tracked
-- migration anywhere in this repo):
--   ux_clients_salon_phone  ON clients (salon_id, phone_country_code, phone_number) WHERE phone_number IS NOT NULL AND is_active
--   ux_clients_salon_email  ON clients (salon_id, lower(email))                     WHERE email IS NOT NULL AND is_active
-- BUT the app-level lookup queries filter on TRIM(phone_number) and
-- LOWER(TRIM(email)) (deliberately ignoring phone_country_code — see
-- findActiveByPhone's comment on why NULL-vs-set country codes must still
-- match) — expressions neither existing index's definition covers, so
-- Postgres cannot use either for these specific queries. Without a matching
-- expression index, every Add Client submission does a full table scan of
-- `clients` once the table gets large. Partial (is_active = true only,
-- matching the queries' WHERE clause) so the index stays small as archived
-- clients accumulate. Distinct names from the two existing unique indexes
-- above — this migration adds new, purely additive supporting indexes, it
-- does not touch or replace either existing constraint.
-- Run by hand against each environment — never auto-run.

CREATE INDEX IF NOT EXISTS ix_clients_active_phone_trimmed
  ON clients (salon_id, TRIM(phone_number))
  WHERE is_active = true AND phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_clients_active_email_trimmed_lower
  ON clients (salon_id, LOWER(TRIM(email)))
  WHERE is_active = true AND email IS NOT NULL;
