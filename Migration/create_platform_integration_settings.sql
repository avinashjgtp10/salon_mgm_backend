-- Platform-wide Google sign-in and billing-email settings, managed by Super Admin (Salon & Billing > Plans > Integrations).
-- ONE row for the whole platform. Secrets (Google client secret, billing SMTP password) are stored encrypted
-- (AES-256-GCM, see modules/ai-credentials/secret-box.ts) and never returned by any API; the API only reports whether
-- they are set and their last 4 characters.
-- The backend reads this row first and falls back, field by field, to the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
-- GOOGLE_REDIRECT_URI / GOOGLE_ONE_TAP_CLIENT_ID / EMAIL_FROM_BILLING / SMTP_BILLING_USER / SMTP_BILLING_PASS environment
-- variables, so leaving the table empty changes nothing for an existing deployment.
-- Run once per environment (dev / QA / prod each have their own DB), BEFORE deploying the backend change.

CREATE TABLE IF NOT EXISTS platform_integration_settings (
  id                         BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),   -- the CHECK keeps this a single-row table
  google_client_id           VARCHAR(255),
  google_client_secret_enc   TEXT,
  google_client_secret_last4 VARCHAR(8),
  google_redirect_uri        VARCHAR(500),
  google_one_tap_client_id   VARCHAR(255),
  billing_email_from         VARCHAR(255),
  billing_smtp_user          VARCHAR(255),
  billing_smtp_pass_enc      TEXT,
  billing_smtp_pass_last4    VARCHAR(8),
  updated_by                 UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
