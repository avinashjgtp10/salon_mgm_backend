-- Calendar > Client permissions as their own keys, the same way Quick Sale has its own
-- (see add_quick_sale_client_permission_keys.sql). The Calendar booking flow used to reuse the Clients module's
-- view_clients / edit_clients, so toggling one silently toggled the other. These three are independent:
--   calendar_view_client     Client List     search / pick a client while booking
--   calendar_edit_client     Edit Client     edit a client's details from the booking
--   calendar_client_history  Client History  open a client's visit / purchase history from the booking
-- Existing roles and staff overrides are seeded from what they already had, so nobody loses access on rollout:
--   Client List     <- view_clients, create_appointment, manage_calendar (any of them that was allowed)
--   Edit Client     <- edit_clients
--   Client History  <- view_client_history (and view_clients, which the calendar used for history until now)
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment
-- (dev/QA/prod) in that order. Safe to re-run.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('calendar_view_client',    'Client List',    'Search and pick a client from the Calendar booking',              'Calendar', NULL, 'view',   'low',    ARRAY['view_calendar']),
  ('calendar_edit_client',    'Edit Client',    'Edit a client''s details from the Calendar booking',              'Calendar', NULL, 'manage', 'medium', ARRAY['view_calendar']),
  ('calendar_client_history', 'Client History', 'Open a client''s visit/purchase history from the Calendar booking', 'Calendar', NULL, 'view',   'low',    ARRAY['view_calendar'])
ON CONFLICT (key) DO NOTHING;

-- Roles: a new key is allowed when ANY of its source keys is allowed for that role.
INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT rp.role_id, m.new_key, BOOL_OR(rp.allowed)
FROM role_permissions rp
JOIN (VALUES
  ('view_clients',        'calendar_view_client'),
  ('create_appointment',  'calendar_view_client'),
  ('manage_calendar',     'calendar_view_client'),
  ('edit_clients',        'calendar_edit_client'),
  ('view_client_history', 'calendar_client_history'),
  ('view_clients',        'calendar_client_history')
) AS m(old_key, new_key) ON rp.permission_key = m.old_key
GROUP BY rp.role_id, m.new_key
ON CONFLICT DO NOTHING;

-- Per-staff overrides: same mapping.
INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed, set_by)
SELECT o.staff_id, m.new_key, BOOL_OR(o.allowed), MAX(o.set_by)
FROM staff_permission_overrides o
JOIN (VALUES
  ('view_clients',        'calendar_view_client'),
  ('create_appointment',  'calendar_view_client'),
  ('manage_calendar',     'calendar_view_client'),
  ('edit_clients',        'calendar_edit_client'),
  ('view_client_history', 'calendar_client_history'),
  ('view_clients',        'calendar_client_history')
) AS m(old_key, new_key) ON o.permission_key = m.old_key
GROUP BY o.staff_id, m.new_key
ON CONFLICT (staff_id, permission_key) DO NOTHING;

COMMIT;
