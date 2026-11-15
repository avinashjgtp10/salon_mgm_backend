-- Super Admin > Client Activity Management: meetings & visits, training progress, activity timeline, follow-up tasks,
-- attachments and an audit trail. Everything is managed by Super Admin; nothing here creates a login.
--
-- The team-member directory is the EXISTING `developers` table (create_developers_table.sql): name + email + phone, no
-- password, no row in `users`. It is reused instead of adding a duplicate `developer_team_members` table.
-- Every salon-specific row carries salon_id. Completed meetings / training history are never deleted (no delete endpoints;
-- salon FKs are RESTRICT so the history can't be wiped by accident).
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in
-- that order. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS client_meetings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  developer_id          UUID REFERENCES developers(id) ON DELETE SET NULL,
  title                 VARCHAR(200) NOT NULL,
  meeting_type          VARCHAR(40)  NOT NULL,
  meeting_date          DATE NOT NULL,
  start_time            TIME,
  end_time              TIME,
  meeting_mode          VARCHAR(20)  NOT NULL DEFAULT 'online',
  location_or_link      TEXT,
  purpose               TEXT,
  agenda                TEXT,
  internal_notes        TEXT,
  status                VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  -- Completion details: required together before status can become 'completed' (enforced in the API and below).
  actual_date           DATE,
  actual_start_time     TIME,
  actual_end_time       TIME,
  discussion_summary    TEXT,
  training_provided     TEXT,
  work_completed        TEXT,
  client_feedback       TEXT,
  issues_discussed      TEXT,
  pending_actions       TEXT,
  next_followup_date    DATE,
  completed_at          TIMESTAMPTZ,
  completed_by          UUID REFERENCES users(id),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_client_meetings_type   CHECK (meeting_type IN ('client_meeting','product_training','technical_support','on_site_visit','online_meeting','phone_discussion','implementation','follow_up')),
  CONSTRAINT chk_client_meetings_mode   CHECK (meeting_mode IN ('on_site','online','phone')),
  CONSTRAINT chk_client_meetings_status CHECK (status IN ('scheduled','completed','rescheduled','cancelled','not_conducted')),
  CONSTRAINT chk_client_meetings_completed CHECK (status <> 'completed' OR (actual_date IS NOT NULL AND discussion_summary IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_client_meetings_salon     ON client_meetings(salon_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_client_meetings_developer ON client_meetings(developer_id);
CREATE INDEX IF NOT EXISTS idx_client_meetings_status    ON client_meetings(status, meeting_date);

-- Attendees: kind 'invited' is set when scheduling, 'present' when completing.
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES client_meetings(id) ON DELETE CASCADE,
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  name        VARCHAR(160) NOT NULL,
  kind        VARCHAR(10)  NOT NULL DEFAULT 'invited' CHECK (kind IN ('invited','present')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_salon   ON meeting_attendees(salon_id);

CREATE TABLE IF NOT EXISTS client_training_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL UNIQUE,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_training_modules (name, is_default, sort_order) VALUES
  ('Salon Profile Setup', true, 1), ('Branch Management', true, 2), ('Staff Management', true, 3),
  ('Services & Pricing', true, 4), ('Designations & Permissions', true, 5), ('Calendar & Appointments', true, 6),
  ('Quick Sale & Billing', true, 7), ('Payment Management', true, 8), ('Inventory Management', true, 9),
  ('WhatsApp Marketing', true, 10), ('Meta Account Setup', true, 11), ('Campaign Creation', true, 12),
  ('Online Booking', true, 13), ('Reports & Analytics', true, 14), ('Memberships & Packages', true, 15)
ON CONFLICT (name) DO NOTHING;

-- One row per salon + module. Training status and client understanding are separate columns on purpose.
CREATE TABLE IF NOT EXISTS client_training_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id             UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  module_id            UUID NOT NULL REFERENCES client_training_modules(id) ON DELETE RESTRICT,
  developer_id         UUID REFERENCES developers(id) ON DELETE SET NULL,
  training_date        DATE,
  status               VARCHAR(20) NOT NULL DEFAULT 'not_started',
  notes                TEXT,
  attending_staff      TEXT,
  duration_minutes     INT CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  client_understanding VARCHAR(20),
  client_feedback      TEXT,
  next_training_date   DATE,
  completed_at         TIMESTAMPTZ,
  created_by           UUID REFERENCES users(id),
  updated_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, module_id),
  CONSTRAINT chk_training_status        CHECK (status IN ('not_started','scheduled','in_progress','completed','needs_retraining')),
  CONSTRAINT chk_training_understanding CHECK (client_understanding IS NULL OR client_understanding IN ('good','average','needs_more_training'))
);
CREATE INDEX IF NOT EXISTS idx_training_progress_salon  ON client_training_progress(salon_id);
CREATE INDEX IF NOT EXISTS idx_training_progress_status ON client_training_progress(status);

CREATE TABLE IF NOT EXISTS client_activity_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  developer_id     UUID REFERENCES developers(id) ON DELETE SET NULL,
  activity_type    VARCHAR(30) NOT NULL,
  activity_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description      TEXT NOT NULL,
  work_completed   TEXT,
  pending_work     TEXT,
  next_followup    DATE,
  -- Set when the entry was written automatically (a completed meeting / training); null for manual entries.
  source_type      VARCHAR(20),
  source_id        UUID,
  created_by       UUID REFERENCES users(id),
  updated_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_activity_type CHECK (activity_type IN ('meeting','training','salon_visit','phone_call','whatsapp_discussion','technical_support','implementation','client_feedback','general'))
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_salon ON client_activity_logs(salon_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type  ON client_activity_logs(activity_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_logs_source ON client_activity_logs(source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_followup_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id           UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  developer_id       UUID REFERENCES developers(id) ON DELETE SET NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  priority           VARCHAR(10) NOT NULL DEFAULT 'medium',
  due_date           DATE,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  completion_notes   TEXT,
  completed_at       TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id),
  updated_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_followup_priority CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT chk_followup_status   CHECK (status IN ('pending','in_progress','completed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_followup_salon  ON client_followup_tasks(salon_id);
CREATE INDEX IF NOT EXISTS idx_followup_due    ON client_followup_tasks(status, due_date);

CREATE TABLE IF NOT EXISTS client_activity_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  entity_type  VARCHAR(20) NOT NULL CHECK (entity_type IN ('meeting','training','activity','task')),
  entity_id    UUID NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_url     TEXT NOT NULL,
  mime_type    VARCHAR(120),
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_attachments_entity ON client_activity_attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_attachments_salon  ON client_activity_attachments(salon_id);

-- Previous / new values for every important change (created, rescheduled, completed, status updated, ...).
CREATE TABLE IF NOT EXISTS client_activity_audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  entity_type    VARCHAR(20) NOT NULL,
  entity_id      UUID NOT NULL,
  action         VARCHAR(40) NOT NULL,
  previous_values JSONB,
  new_values     JSONB,
  changed_by     UUID REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_audit_entity ON client_activity_audit_logs(entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_audit_salon  ON client_activity_audit_logs(salon_id, changed_at DESC);

COMMIT;
