-- Super Admin activity log: who (a Super Admin login) created / edited / blocked / impersonated an account or changed a salon.
-- The backend also creates this table by itself the first time a change is logged, so running it by hand is optional. Safe to re-run.
CREATE TABLE IF NOT EXISTS super_admin_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID NOT NULL,
  actor_email  VARCHAR(255),
  action       VARCHAR(60) NOT NULL,
  entity_type  VARCHAR(30),
  entity_id    TEXT,
  entity_label VARCHAR(255),
  details      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sa_activity_actor ON super_admin_activity_log (actor_id, created_at DESC);
