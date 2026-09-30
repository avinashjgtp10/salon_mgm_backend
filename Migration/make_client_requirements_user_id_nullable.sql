-- Requirements are now created by Super Admin on the salon's behalf (no
-- salon-facing self-submission), so there's no submitting user_id to store
-- — the client contact is always the salon's own owner, resolved via a
-- join to salons.owner_id instead. Safe to re-run.

ALTER TABLE client_requirements ALTER COLUMN user_id DROP NOT NULL;
