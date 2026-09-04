-- Adds structured, titled walkthrough sections to spotlight_features — each
-- section has its own title, description, and independent set of
-- screenshots (see SpotlightSection in spotlight.types.ts). Separate from
-- the existing `images` column (the flat cover-photo / "Why it works"
-- gallery) so a feature can carry both without them mixing. JSONB, same
-- pattern as `images`/`target_audience` on this table — sections are always
-- read/written whole with their parent row, never queried individually, so
-- a child table would just add join overhead for no benefit.
-- Run by hand against each environment — never auto-run.

ALTER TABLE spotlight_features
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;
