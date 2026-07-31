ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS is_visit_condition_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_after_visits INTEGER;

ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_apply_after_visits_positive;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_apply_after_visits_positive
  CHECK (
    is_visit_condition_enabled = false
    OR (apply_after_visits IS NOT NULL AND apply_after_visits >= 1)
  );
