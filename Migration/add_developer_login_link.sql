-- Optional Super Admin login for a developer / team member.
-- The `developers` directory stays a plain contact list; a developer who is given a login gets a normal
-- users row (role = 'super_admin', same email) and this column points at it. No password is stored on `developers`.
-- Deactivating or deleting the developer disables the linked login (done in the API).
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment. Safe to re-run.

BEGIN;

ALTER TABLE developers ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
