-- Fixes a pre-existing data bug (predates the Reports permissions ticket
-- entirely): view_sales was tagged module='Reports' while its sibling key
-- create_sales correctly lives in module='Quick Sale' — same feature (Quick
-- Sale / POS access), split across two modules by mistake. This is what was
-- showing up as a second, unwanted item in Reports' "General" section
-- alongside view_reports. Moved to match create_sales; no functional
-- change, view_sales is still enforced exactly where it always was
-- (sales.routes.ts), this only fixes where its toggle appears in Roles &
-- Permissions.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET module = 'Quick Sale' WHERE key = 'view_sales';

COMMIT;
