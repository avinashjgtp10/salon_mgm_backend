-- Salon-level monthly sales target, shown on the Dashboard's "Monthly
-- Projection & Growth" card (Target / % achieved / Required Daily Sales).
--
-- NULL = no target set; the card then shows "Set target" instead of a bar.
-- Run this BEFORE deploying the backend change that edits it (the read path
-- tolerates the column being missing, but saving a target would 500).
--
-- Safe to re-run.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS monthly_sales_target NUMERIC(14, 2);
