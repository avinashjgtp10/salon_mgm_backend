-- Coupon Designer — stores the design document a salon builds in the editor.
--
-- Shape follows the wa_templates precedent: fixed scalar columns for anything
-- the gallery needs to list/filter on, plus ONE jsonb column holding the
-- free-form element tree. Listing a salon's designs must never have to parse
-- `doc`, which is why preset/width/height are denormalised out of it.
--
-- salon_id is NULLABLE on purpose, matching wa_automation_templates: a NULL
-- row is a SalonOx-provided starter template visible to everyone, which a
-- salon forks into its own row on first edit. Same "prefer own over global"
-- semantics coupons already use in findByCodeForSalon().

CREATE TABLE IF NOT EXISTS coupon_designs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID REFERENCES salons(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL DEFAULT 'Untitled design',
  kind          VARCHAR(16)  NOT NULL DEFAULT 'design',
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
  preset        VARCHAR(48)  NOT NULL DEFAULT 'coupon_card',
  width_px      INTEGER      NOT NULL,
  height_px     INTEGER      NOT NULL,
  doc           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  -- The coupon whose code/discount/expiry fill this design's {{tokens}}.
  -- SET NULL rather than CASCADE: deleting a coupon shouldn't destroy
  -- artwork the salon may want to re-point at a different coupon.
  coupon_id     UUID REFERENCES coupons(id) ON DELETE SET NULL,
  tags          TEXT[]       NOT NULL DEFAULT '{}',
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Safety net: if coupon_designs already existed from an earlier run of this file,
-- CREATE TABLE IF NOT EXISTS above is a no-op — add/replace the constraints
-- explicitly so this file stays safe to re-run.
ALTER TABLE coupon_designs DROP CONSTRAINT IF EXISTS coupon_designs_kind_check;
ALTER TABLE coupon_designs
  ADD CONSTRAINT coupon_designs_kind_check CHECK (kind IN ('design', 'template'));

ALTER TABLE coupon_designs DROP CONSTRAINT IF EXISTS coupon_designs_status_check;
ALTER TABLE coupon_designs
  ADD CONSTRAINT coupon_designs_status_check CHECK (status IN ('draft', 'published', 'archived'));

ALTER TABLE coupon_designs DROP CONSTRAINT IF EXISTS coupon_designs_size_check;
ALTER TABLE coupon_designs
  ADD CONSTRAINT coupon_designs_size_check CHECK (width_px > 0 AND height_px > 0);

-- Gallery listing: a salon's own designs, newest first.
CREATE INDEX IF NOT EXISTS idx_coupon_designs_salon
  ON coupon_designs (salon_id, updated_at DESC);

-- Starter templates are read on every editor open by every salon, so they
-- get their own partial index rather than scanning past salon rows.
CREATE INDEX IF NOT EXISTS idx_coupon_designs_global
  ON coupon_designs (updated_at DESC) WHERE salon_id IS NULL;
