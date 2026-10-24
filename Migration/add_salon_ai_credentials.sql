-- Per-salon Cloudflare Workers AI credentials for LUNOX, managed by Super Admin (Salon Customization page).
--
-- A row means LUNOX is ENABLED for that salon and uses that salon's own Cloudflare account; no row means
-- LUNOX is locked (the buttons stay visible and show "Upgrade your plan"). So running this changes nothing
-- until a super admin saves a key for a salon.
--
-- The token is stored ENCRYPTED (AES-256-GCM, key derived from the backend's existing JWT_SECRET) and is never
-- returned by any API; token_last4 is only for display ("••••a1b2").
--
-- Additive and safe to run BEFORE the backend/frontend that use it are deployed (the backend treats a missing
-- table as "LUNOX not enabled"). Run once per database (dev / qa / prod) by hand. Re-runnable (IF NOT EXISTS).
-- Cascades away with the salon itself.

CREATE TABLE IF NOT EXISTS salon_ai_credentials (
  salon_id         UUID        PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  cf_account_id    VARCHAR(64) NOT NULL,
  cf_api_token_enc TEXT        NOT NULL,
  token_last4      VARCHAR(8)  NOT NULL,
  updated_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
