-- Category icons.
--
-- Each service category can now carry an icon, picked when the category is created
-- or edited. The column stores a short KEY (e.g. 'hair', 'nails', 'facial') that the
-- frontend maps to an icon — not an image or URL — so icons can be restyled or
-- swapped in the app without touching data.
--
-- NULL = no icon chosen yet. The frontend then guesses one from the category name
-- (a category called "Hair" shows the hair icon) and falls back to a neutral icon,
-- so existing categories need no backfill and nothing breaks if this stays NULL.
--
-- Safe to run more than once. RUN THIS BEFORE deploying the backend change: category
-- create/update writes this column and will fail with "column icon does not exist"
-- until it exists.

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS icon VARCHAR(40);
