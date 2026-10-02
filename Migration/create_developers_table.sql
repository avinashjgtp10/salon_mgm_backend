-- Plain developer contact records — name + email (+ optional phone) only.
-- NOT a login-capable account: no password, no row in `users`, no platform
-- access whatsoever. Exists solely so a requirement can be assigned to a
-- real person who then receives assignment/status-change emails. Replaces
-- the earlier (overcorrected) approach of creating a real users.role =
-- 'super_admin' account per developer, which wrongly granted full platform
-- access just to receive email notifications.
CREATE TABLE IF NOT EXISTS developers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  phone       VARCHAR(30),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_developers_is_active ON developers(is_active);
