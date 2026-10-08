-- Dashboard card permissions (view_dashboard_card_*) are children of
-- view_dashboard. Declares that edge in the catalog (so the editors' save-time
-- prerequisite check applies) and clears any card left ON under a role whose
-- View Dashboard is OFF — the invalid state this ticket forbids.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions
SET depends_on = ARRAY['view_dashboard']
WHERE key LIKE 'view_dashboard_card_%';

UPDATE role_permissions
SET allowed = FALSE
WHERE permission_key LIKE 'view_dashboard_card_%'
  AND allowed = TRUE
  AND role_id NOT IN (
    SELECT role_id FROM role_permissions
    WHERE permission_key = 'view_dashboard' AND allowed = TRUE
  );

COMMIT;
