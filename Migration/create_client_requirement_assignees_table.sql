-- Multi-developer assignment at requirement-creation time — replaces the
-- single client_requirements.assigned_to column (kept for backward compat /
-- "primary assignee" convenience) with a proper many-to-many table so a
-- requirement can have several developers, each with an optional free-text
-- role label (e.g. "Lead Developer", "Reviewer"). Safe to re-run.

CREATE TABLE IF NOT EXISTS client_requirement_assignees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id  UUID NOT NULL REFERENCES client_requirements(id) ON DELETE CASCADE,
  developer_id    UUID NOT NULL REFERENCES users(id),
  role_label      VARCHAR(60),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requirement_id, developer_id)
);

CREATE INDEX IF NOT EXISTS idx_client_requirement_assignees_requirement_id ON client_requirement_assignees(requirement_id);
CREATE INDEX IF NOT EXISTS idx_client_requirement_assignees_developer_id ON client_requirement_assignees(developer_id);
