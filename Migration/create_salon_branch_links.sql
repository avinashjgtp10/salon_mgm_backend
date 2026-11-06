-- Settings > Migration > Connected Branches.
--
-- An owner connects other SalonOX accounts (verified by that account's own email + password, and only when its
-- subscription is live). The owner also sets ONE branch login (username + password). That login is a normal
-- `branch_owner` user, so it opens the existing Branch Owner portal (/branch-owner), where every connected salon
-- (plus the owner's own) is listed via branch_owner_salons and can be entered. The connected account's own password
-- is never stored.
--
-- RUN BY HAND on every database (dev, QA, prod) BEFORE deploying the backend that reads it.
-- Idempotent: safe to run twice. It also converts the first version of this table (per-branch usernames), keeping
-- the existing connections; owners then set the shared branch login from Settings.

-- The shared branch login: one per owner's salon. The password lives on the branch_owner user (users.password_hash).
CREATE TABLE IF NOT EXISTS salon_branch_logins (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_salon_id      UUID NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
  branch_owner_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  username             TEXT NOT NULL,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usernames are globally unique and case-insensitive (the login box accepts an email OR a username).
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_branch_logins_username ON salon_branch_logins (LOWER(username));

-- Which salons are connected to which owner's salon.
CREATE TABLE IF NOT EXISTS salon_branch_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_salon_id  UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  -- UNIQUE: a salon can be a branch of at most one parent.
  branch_salon_id  UUID NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_branch_links_parent ON salon_branch_links (parent_salon_id);

-- Convert the first version (per-branch credentials on the link row). Connections are kept; credentials move to
-- salon_branch_logins and are set again from Settings. No-ops on a fresh database.
DROP INDEX IF EXISTS uq_salon_branch_links_username;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS branch_owner_user_id;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS username;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS password_hash;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS is_active;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE salon_branch_links DROP COLUMN IF EXISTS updated_at;

-- Who connected / disconnected / reset / opened the portal, from where.
CREATE TABLE IF NOT EXISTS salon_branch_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_salon_id UUID,
  branch_salon_id UUID,
  actor_user_id   UUID,
  action          TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_branch_audit_parent ON salon_branch_audit (parent_salon_id, created_at DESC);

-- Permission key for the Settings section (owner-only in the UI; routes are gated on the salon_owner role).
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_settings_branches', 'Connected Branches', 'Open the Connected Branches settings section', 'Settings', 'Migration', 'view', 'high', NULL)
ON CONFLICT (key) DO NOTHING;
