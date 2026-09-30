-- Client Requirements tracking (REQ-001 style tickets) — a salon owner/staff
-- raises a feature/change requirement from their own dashboard, Super Admin
-- tracks and responds to it with a status workflow and an update timeline
-- distinguishing internal-only notes from client-visible updates (both of
-- which trigger email notifications on the client-update path). Modeled on
-- support_tickets' shape/conventions but with a proper update-history child
-- table instead of a single overwritable admin_reply. Safe to re-run.

CREATE TABLE IF NOT EXISTS client_requirements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  req_number    INTEGER NOT NULL,
  salon_id      UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  title         VARCHAR(255) NOT NULL,
  description   TEXT NOT NULL,
  priority      VARCHAR(20) NOT NULL DEFAULT 'medium', -- low | medium | high
  status        VARCHAR(20) NOT NULL DEFAULT 'open',   -- open | in_progress | completed
  assigned_to   UUID REFERENCES users(id),
  target_date   DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (req_number)
);

CREATE INDEX IF NOT EXISTS idx_client_requirements_salon_id ON client_requirements(salon_id);
CREATE INDEX IF NOT EXISTS idx_client_requirements_status ON client_requirements(status);
CREATE INDEX IF NOT EXISTS idx_client_requirements_created_at ON client_requirements(created_at DESC);

-- Global sequence for req_number, formatted "REQ-001" in application code —
-- same nextval()-is-atomic reasoning as salon_plan_invoice_no_seq, so
-- concurrent submissions can never collide on the same number.
CREATE SEQUENCE IF NOT EXISTS client_requirement_req_no_seq START 1;

-- One row per timeline entry — both "Internal Note" (team-only, no email)
-- and "Client Update" (emails client + team, the client-visible history)
-- live here, distinguished by update_type. Also covers status-change
-- system entries (update_type='status_change') so the Updates tab shows a
-- single unified timeline instead of stitching two sources together.
CREATE TABLE IF NOT EXISTS client_requirement_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id  UUID NOT NULL REFERENCES client_requirements(id) ON DELETE CASCADE,
  author_id       UUID REFERENCES users(id),
  update_type     VARCHAR(20) NOT NULL, -- internal_note | client_update | status_change
  message         TEXT NOT NULL,
  old_status      VARCHAR(20),
  new_status      VARCHAR(20),
  emailed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_requirement_updates_requirement_id ON client_requirement_updates(requirement_id);
