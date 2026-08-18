CREATE TABLE IF NOT EXISTS salon_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_groups_owner_id ON salon_groups(owner_id);

-- salon_id is UNIQUE — a salon belongs to at most one group.
CREATE TABLE IF NOT EXISTS salon_group_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_group_id UUID NOT NULL REFERENCES salon_groups(id) ON DELETE CASCADE,
  salon_id       UUID NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_group_members_group_id ON salon_group_members(salon_group_id);
