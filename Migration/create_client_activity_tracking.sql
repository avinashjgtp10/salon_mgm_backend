-- Super Admin → Client Activity Tracking.
--
-- Two tables, written by the backend (never by the clients themselves) and read only through the
-- Super Admin routes (/api/v1/super-admin/client-activity/*):
--
--   client_activity_summary  one row per (account, platform): first/last login, last logout, last
--                            activity, login count. This is what the tracking list and the status
--                            (Online / Active / Inactive) are computed from.
--   client_activity_events   the history: every login and logout, plus throttled "activity" rows
--                            (one per account + platform + module per 10 minutes) so the history shows
--                            what the account actually did after logging in without one row per request.
--
-- platform is 'web' or 'app' (the mobile app). It comes from the login session's client type
-- (refresh_tokens.client_type: web | mobile), so every later request is tied to the platform that
-- logged in. Super-admin accounts and impersonation sessions are never tracked.
--
-- Per project policy this file is created but NOT auto-run: apply it by hand against each environment
-- (dev -> QA -> prod) BEFORE the backend that writes to it is deployed. Idempotent, safe to re-run.
-- Until it is run the backend just logs a warning and tracks nothing - it never breaks a request.

BEGIN;

CREATE TABLE IF NOT EXISTS client_activity_summary (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform         VARCHAR(5) NOT NULL CHECK (platform IN ('web','app')),
  salon_id         UUID,
  first_login_at   TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  last_logout_at   TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  login_count      INTEGER NOT NULL DEFAULT 0,
  last_module      VARCHAR(60),
  last_ip          VARCHAR(64),
  last_user_agent  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_client_activity_summary_last_activity ON client_activity_summary (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_activity_summary_salon         ON client_activity_summary (salon_id);

CREATE TABLE IF NOT EXISTS client_activity_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  salon_id    UUID,
  platform    VARCHAR(5) NOT NULL CHECK (platform IN ('web','app')),
  event_type  VARCHAR(10) NOT NULL CHECK (event_type IN ('login','activity','logout')),
  module      VARCHAR(60),
  ip          VARCHAR(64),
  user_agent  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_activity_events_user     ON client_activity_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_activity_events_time     ON client_activity_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_activity_events_platform ON client_activity_events (platform, occurred_at DESC);

COMMIT;
