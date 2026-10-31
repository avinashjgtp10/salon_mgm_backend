-- Direct salon -> developer assignment, set from Super Admin > Real Salons > Actions > Assign Developer.
-- Independent of client requirements (those keep their own per-requirement assignees). Safe to re-run.

CREATE TABLE IF NOT EXISTS salon_developers (
  salon_id      UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  developer_id  UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (salon_id, developer_id)
);

CREATE INDEX IF NOT EXISTS idx_salon_developers_developer_id ON salon_developers(developer_id);
