-- Spotlight Features: superadmin-authored "what's new" announcements shown
-- to salon users. Replaces the frontend's localStorage-only mock (see
-- src/modules/spotlight/spotlight.controller.ts's old header comment) with
-- a real, shared table so a feature published by superadmin is visible to
-- every salon, not just the browser that created it.
--
-- images/target_audience are JSONB arrays rather than child tables — this
-- data is small, always read/written as a whole with its parent row (never
-- queried by individual image), and mirrors the frontend's
-- SpotlightFeature.images: SpotlightImage[] / targetAudience: TargetAudience[]
-- shape exactly, so the API can pass them straight through with no mapping
-- layer.
--
-- Run by hand against each environment — never auto-run.

CREATE TABLE IF NOT EXISTS spotlight_features (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name       VARCHAR(200)  NOT NULL,
  module             VARCHAR(120)  NOT NULL,
  module_route       VARCHAR(300),
  short_description  TEXT          NOT NULL,
  what_is_this       TEXT          NOT NULL DEFAULT '',
  how_it_works       TEXT          NOT NULL DEFAULT '',
  benefits           TEXT          NOT NULL DEFAULT '',
  images             JSONB         NOT NULL DEFAULT '[]'::jsonb,
  video_url          TEXT,
  release_date       DATE          NOT NULL DEFAULT CURRENT_DATE,
  target_audience    JSONB         NOT NULL DEFAULT '["all"]'::jsonb,
  status             VARCHAR(20)   NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'archived')),
  -- Set the moment status first transitions to 'published' — this is what
  -- the publish-broadcast (notify every salon) keys off of, distinct from
  -- created_at (drafted long before) and updated_at (bumped by any later
  -- edit, which must NOT re-trigger a second broadcast).
  published_at       TIMESTAMPTZ,
  created_by         UUID          REFERENCES users(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spotlight_features_status ON spotlight_features(status);
CREATE INDEX IF NOT EXISTS idx_spotlight_features_published_at ON spotlight_features(published_at DESC);

-- Per-user "explored" state — deliberately separate from the shared,
-- salon-scoped `notifications` table (which has no user_id column and is
-- read/marked-read per salon, not per login). explored_at is set the
-- moment a user opens the feature detail (SpotlightListPage's openFeature),
-- clearing the NEW badge/dashboard card for that user specifically without
-- touching any other staff login at the same salon.
CREATE TABLE IF NOT EXISTS spotlight_feature_reads (
  feature_id     UUID          NOT NULL REFERENCES spotlight_features(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  explored_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (feature_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_spotlight_feature_reads_user ON spotlight_feature_reads(user_id);
