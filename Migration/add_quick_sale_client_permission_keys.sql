-- Quick Sale > Client permissions as their own keys. Previously Quick Sale's
-- client panel reused the Clients module's edit_clients/view_clients, so
-- toggling one silently toggled the other. These three are independent:
-- quick_sale_view_client, quick_sale_edit_client, quick_sale_client_history.
-- Existing roles/overrides are seeded from the current Clients values so
-- nobody loses access on rollout.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('quick_sale_view_client',    'View Client',    'Look up and view client details from Quick Sale',   'Quick Sale', NULL, 'view',   'low',    ARRAY['create_sales']),
  ('quick_sale_edit_client',    'Edit Client',    'Edit a client''s details from Quick Sale',          'Quick Sale', NULL, 'manage', 'medium', ARRAY['create_sales']),
  ('quick_sale_client_history', 'Client History', 'Open a client''s visit/purchase history from Quick Sale', 'Quick Sale', NULL, 'view', 'low', ARRAY['create_sales'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, m.new_key, allowed
FROM role_permissions rp
JOIN (VALUES
  ('view_clients',        'quick_sale_view_client'),
  ('edit_clients',        'quick_sale_edit_client'),
  ('view_client_history', 'quick_sale_client_history')
) AS m(old_key, new_key) ON rp.permission_key = m.old_key
ON CONFLICT DO NOTHING;

INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed, set_by)
SELECT o.staff_id, m.new_key, o.allowed, o.set_by
FROM staff_permission_overrides o
JOIN (VALUES
  ('view_clients',        'quick_sale_view_client'),
  ('edit_clients',        'quick_sale_edit_client'),
  ('view_client_history', 'quick_sale_client_history')
) AS m(old_key, new_key) ON o.permission_key = m.old_key
ON CONFLICT (staff_id, permission_key) DO NOTHING;

COMMIT;
