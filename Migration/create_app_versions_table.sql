-- Global (non-salon-scoped) mobile application version configuration, read by
-- the SalonOX mobile app on cold start to decide whether to prompt for a store
-- update. Deliberately NOT stored in the `settings` table: that table is keyed
-- by salon_id and gated behind salon-staff roles, while this configuration is
-- app-wide and must be readable before authentication.
--
-- One row per (platform, environment): iOS and Android drift apart whenever
-- App Store review lags Play, and dev/QA builds carry different package ids
-- (com.salonox.app.dev / .qa) that are not published to any store.
--
-- Both store URLs live on every row even though a row is per-platform: the
-- mobile client reads androidStoreUrl AND iosStoreUrl from a single response
-- and picks with Platform.OS, so splitting them across rows would break the
-- already-shipped client contract.

CREATE TABLE IF NOT EXISTS app_versions (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  platform                  VARCHAR(10)   NOT NULL CHECK (platform IN ('android', 'ios')),
  environment               VARCHAR(20)   NOT NULL CHECK (environment IN ('development', 'qa', 'production')),
  latest_version            VARCHAR(32)   NOT NULL,
  minimum_supported_version VARCHAR(32)   NOT NULL,
  force_update              BOOLEAN       NOT NULL DEFAULT FALSE,
  android_store_url         TEXT,
  ios_store_url             TEXT,
  title                     VARCHAR(120),
  message                   TEXT,
  release_notes             JSONB         NOT NULL DEFAULT '[]'::jsonb,
  updated_by                UUID,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One configuration per platform+environment; the admin upsert relies on
  -- this constraint as its ON CONFLICT target.
  CONSTRAINT uq_app_versions_platform_environment UNIQUE (platform, environment),

  -- Hard stop against force-updating a dev/QA build: those package ids are not
  -- on any store, so "Update Now" would dead-end with no way out of a blocking
  -- screen. The service layer enforces this too — this is the last line.
  CONSTRAINT chk_app_versions_force_update_production_only
    CHECK (force_update = FALSE OR environment = 'production'),

  -- release_notes is a JSON array of { title, description } objects.
  CONSTRAINT chk_app_versions_release_notes_is_array
    CHECK (jsonb_typeof(release_notes) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_app_versions_lookup
  ON app_versions (platform, environment);
