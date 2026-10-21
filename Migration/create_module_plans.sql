-- Feature plans (Basic / Advance / Growth), managed by Super Admin (Plans page).
--
-- A plan is a named set of LOCKED module keys (same keys as salon_module_locks /
-- Salon Customization). A plan that hasn't been configured yet (configured = FALSE)
-- is reported by the API as "everything locked" so each plan is built up from Off.
--
-- Exactly three fixed plans are seeded; there is no create/delete endpoint.
-- Additive and re-runnable (IF NOT EXISTS / ON CONFLICT DO NOTHING). The backend
-- also creates this table on first use if the migration hasn't been run yet.

CREATE TABLE IF NOT EXISTS module_plans (
  slug            VARCHAR(20)  PRIMARY KEY,
  name            VARCHAR(50)  NOT NULL,
  sort_order      INT          NOT NULL DEFAULT 0,
  locked_modules  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  configured      BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO module_plans (slug, name, sort_order) VALUES
  ('basic',   'Basic',   1),
  ('advance', 'Advance', 2),
  ('growth',  'Growth',  3)
ON CONFLICT (slug) DO NOTHING;
