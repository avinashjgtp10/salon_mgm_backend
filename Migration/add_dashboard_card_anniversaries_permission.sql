-- Today's Anniversaries card on the main Dashboard — sits next to Today's
-- Birthdays and is toggled independently per role/staff member, exactly like
-- the other view_dashboard_card_* keys (see
-- add_dashboard_card_visibility_permissions.sql). Display-only: enforced by
-- getCombined()'s field redaction in salon-dashboard.controller.ts.
--
-- Backfills allowed=true for every existing role so the new card shows
-- right after deploy (an unconfigured key resolves to DENIED for roles on the
-- role_id-backed path); owners can then switch it off per role.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_dashboard_card_anniversaries', 'Today''s Anniversaries Card', 'See the Today''s Anniversaries card on the dashboard', 'Dashboard', NULL, 'view', 'low', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT r.id, 'view_dashboard_card_anniversaries', TRUE
FROM roles r
ON CONFLICT (role_id, permission_key) DO NOTHING;

COMMIT;
