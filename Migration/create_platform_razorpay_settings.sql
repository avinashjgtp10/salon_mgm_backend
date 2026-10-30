-- Platform-wide Razorpay credentials, managed by Super Admin (Plans > Payment Gateway).
-- ONE row for the whole platform (not per salon): the money collected is salons paying SalonOx for their plan.
-- Secrets are stored encrypted (AES-256-GCM, see modules/ai-credentials/secret-box.ts) and never returned by any API;
-- the API only reports whether they are set and their last 4 characters.
-- The backend reads this row first and falls back to the RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
-- environment variables, so leaving the table empty changes nothing for an existing deployment.
-- Run once per environment (dev / QA / prod each have their own DB).

CREATE TABLE IF NOT EXISTS platform_razorpay_settings (
  id                   BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),   -- the CHECK keeps this a single-row table
  key_id               VARCHAR(100),
  key_secret_enc       TEXT,
  key_secret_last4     VARCHAR(8),
  webhook_secret_enc   TEXT,
  webhook_secret_last4 VARCHAR(8),
  updated_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
