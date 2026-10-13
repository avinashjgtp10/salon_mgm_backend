-- Catalog → Tool Tracking (reusable assets: tools, dryers, clippers, laptops, POS...).
--
-- Three tables + six permission keys. Per project policy this file is created but NOT
-- auto-run: apply it by hand against each environment (dev → QA → prod), BEFORE the
-- backend that uses it is deployed. Fully idempotent, safe to re-run.
--
--   assets           one row per physical asset; carries its CURRENT status / custodian
--   asset_events     append-only history (register, issue, return, transfer, condition
--                    change, damage/missing, maintenance...). Never updated or deleted —
--                    a trigger enforces it, so re-issuing an asset never overwrites the past.
--   asset_incidents  damage / missing reports and their investigation status
--
-- Permissions are NOT granted to any role here (the salon owner always has access);
-- grant them to roles from Settings → Roles & Permissions → Catalog → Tool Tracking.

BEGIN;

CREATE TABLE IF NOT EXISTS assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  branch_id             UUID REFERENCES branches(id) ON DELETE SET NULL,
  asset_seq             INTEGER NOT NULL,                       -- per-salon running number
  asset_code            VARCHAR(20) NOT NULL,                   -- AST-00001
  name                  VARCHAR(150) NOT NULL,
  category              VARCHAR(80),
  brand                 VARCHAR(80),
  model                 VARCHAR(80),
  serial_number         VARCHAR(120),
  photo_url             TEXT,
  condition             VARCHAR(12) NOT NULL DEFAULT 'good'
                          CHECK (condition IN ('new','good','fair','damaged')),
  status                VARCHAR(20) NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available','issued','under_maintenance','missing','retired')),
  needs_inspection      BOOLEAN NOT NULL DEFAULT FALSE,         -- set when returned damaged; blocks re-issue until cleared
  current_staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,   -- current custodian
  issued_at             TIMESTAMPTZ,
  expected_return_at    TIMESTAMPTZ,
  notes                 TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, asset_seq),
  UNIQUE (salon_id, asset_code),
  -- an asset is held by someone if and only if it is issued
  CONSTRAINT assets_custodian_matches_status
    CHECK ((status = 'issued') = (current_staff_id IS NOT NULL))
);
-- Logo picked from the tool-icon catalog (e.g. 'hair-dryer'). Added after the first release, so the
-- table above may already exist without it.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS icon VARCHAR(40);
-- Optional uploaded images: purchase receipt and warranty card.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS warranty_card_url TEXT;

CREATE INDEX IF NOT EXISTS idx_assets_salon_status ON assets (salon_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_salon_branch ON assets (salon_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_assets_custodian    ON assets (current_staff_id) WHERE current_staff_id IS NOT NULL;

-- Categories the salon has created (shown in Tool Tracking → Category even before any
-- asset uses them). Categories already typed onto assets are merged in by the API.
CREATE TABLE IF NOT EXISTS asset_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_categories_salon_name ON asset_categories (salon_id, LOWER(name));

CREATE TABLE IF NOT EXISTS asset_incidents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id               UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  asset_id               UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  incident_type          VARCHAR(10) NOT NULL CHECK (incident_type IN ('damaged','missing')),
  reported_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_staff_id          UUID REFERENCES staff(id) ON DELETE SET NULL,  -- last RECORDED custodian (not an assumption of fault)
  last_condition         VARCHAR(12),
  description            TEXT NOT NULL,
  photo_url              TEXT,
  reported_by            UUID,
  investigation_status   VARCHAR(15) NOT NULL DEFAULT 'open'
                           CHECK (investigation_status IN ('open','investigating','resolved','closed')),
  resolution_notes       TEXT,
  resolved_by            UUID,
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_incidents_salon_status ON asset_incidents (salon_id, investigation_status);
CREATE INDEX IF NOT EXISTS idx_asset_incidents_asset        ON asset_incidents (asset_id);

CREATE TABLE IF NOT EXISTS asset_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id            UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  asset_id            UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_type          VARCHAR(30) NOT NULL CHECK (event_type IN (
                        'registered','updated','issued','returned','transferred','condition_changed',
                        'damage_reported','missing_reported','incident_updated','found',
                        'maintenance_started','maintenance_completed','inspection_cleared','retired')),
  staff_id            UUID REFERENCES staff(id) ON DELETE SET NULL,   -- who the asset was issued to / returned by
  branch_id           UUID,
  from_branch_id      UUID,
  condition           VARCHAR(12),
  from_condition      VARCHAR(12),
  status_after        VARCHAR(20),
  expected_return_at  TIMESTAMPTZ,
  incident_id         UUID REFERENCES asset_incidents(id) ON DELETE SET NULL,
  notes               TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by         UUID,                                           -- users.id of whoever entered it
  recorded_by_name    VARCHAR(150),                                   -- kept as text so it survives user changes
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_events_asset ON asset_events (asset_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_events_salon ON asset_events (salon_id, occurred_at DESC);

-- The history is an audit trail: UPDATE is blocked by a trigger, and the app has no delete
-- path for events, so re-issuing an asset can never overwrite what came before.
CREATE OR REPLACE FUNCTION asset_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'asset_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asset_events_immutable ON asset_events;
CREATE TRIGGER trg_asset_events_immutable
  BEFORE UPDATE ON asset_events
  FOR EACH ROW EXECUTE FUNCTION asset_events_immutable();

-- ── Permissions (Catalog → "Tool Tracking" section in Roles & Permissions) ──────────
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on, display_order) VALUES
  ('view_assets',                  'View Assets',            'Open Catalog → Tool Tracking and see the asset list and details',        'Catalog', 'Tool Tracking', 'view',   'low',    NULL,                          0),
  ('manage_assets',                'Add / Edit Assets',      'Register assets, edit their details, move between branches, retire',     'Catalog', 'Tool Tracking', 'edit',   'medium', ARRAY['view_assets'],          1),
  ('issue_return_assets',          'Issue / Return Assets',  'Hand an asset to a staff member and record its return',                  'Catalog', 'Tool Tracking', 'manage', 'medium', ARRAY['view_assets'],          2),
  ('report_asset_incidents',       'Report Damage / Missing','Report an asset as damaged or missing',                                   'Catalog', 'Tool Tracking', 'create', 'medium', ARRAY['view_assets'],          3),
  ('view_asset_history',           'View Asset History',     'See the full handover, condition and incident history of an asset',       'Catalog', 'Tool Tracking', 'view',   'low',    ARRAY['view_assets'],          4),
  ('manage_asset_investigations',  'Manage Investigations',  'Update the investigation status and resolution of damage / missing reports', 'Catalog', 'Tool Tracking', 'manage', 'high',   ARRAY['view_assets','view_asset_history'], 5)
ON CONFLICT (key) DO NOTHING;

COMMIT;
