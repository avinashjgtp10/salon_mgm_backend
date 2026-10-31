-- Per-salon module locks, managed by Super Admin (Salon Customization page).
--
-- A row in salon_module_locks means that module is LOCKED for that salon; no
-- row means unlocked. A salon with no rows therefore has everything on, so
-- running this changes nothing until a super admin locks something.
--
-- Additive and safe to run BEFORE the backend/frontend that use it are
-- deployed (the backend also treats a missing table as "nothing locked", so
-- the reverse order does not break anything either). Run once per database
-- (dev / qa / prod) by hand. Re-runnable (IF NOT EXISTS).
--
-- Deliberately NOT added to the clear-salon-data purge list: locks are
-- commercial configuration, not salon data. Both tables cascade-delete with
-- the salon itself.

CREATE TABLE IF NOT EXISTS salon_module_locks (
  salon_id    UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  module_key  VARCHAR(50) NOT NULL,
  locked_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (salon_id, module_key)
);

-- Who changed which salon's locks, and what they were before/after.
-- previous/new are JSONB arrays of module keys that were/are locked.
CREATE TABLE IF NOT EXISTS salon_module_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  changed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  previous    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  new         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_module_audit_log_salon
  ON salon_module_audit_log (salon_id, created_at DESC);
