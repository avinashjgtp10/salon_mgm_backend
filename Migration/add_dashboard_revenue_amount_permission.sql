-- "See Revenue Amount in Number Form" (Settings > Roles & Permissions > Dashboard).
-- ON: dashboard revenue figures are shown as numbers. OFF: they are masked as "***" on screen AND removed from the
-- dashboard API responses (see salon-dashboard.controller.ts), so they cannot be read from the network either.
--
-- Backfills allowed=true for every existing role so nothing changes right after deploy (an unconfigured key resolves
-- to DENIED on the role_id-backed path); owners can then switch it off per role.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod).

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_dashboard_revenue_amount', 'See Revenue Amount in Number Form', 'Show dashboard revenue amounts as numbers; when off they appear as ***', 'Dashboard', NULL, 'view', 'medium', ARRAY['view_dashboard'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT r.id, 'view_dashboard_revenue_amount', TRUE
FROM roles r
ON CONFLICT (role_id, permission_key) DO NOTHING;

COMMIT;
