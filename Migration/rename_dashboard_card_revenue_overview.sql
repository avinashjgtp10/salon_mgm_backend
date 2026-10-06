-- Display-name change only: the view_dashboard_card_revenue_overview
-- permission is now shown as "Monthly Projection & Growth" in Roles &
-- Permissions. The key is unchanged, so no role/staff data is affected.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions
SET name = 'Monthly Projection & Growth'
WHERE key = 'view_dashboard_card_revenue_overview';

COMMIT;
