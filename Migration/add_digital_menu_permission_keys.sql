-- Digital Menu / QR Menu feature — new RBAC permission keys.
-- Matches the frontend's src/features/settings/data/permissionMatrix.ts and
-- the DEFAULT_STAFF_PERMS map in src/middleware/permission.middleware.ts.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment, after create_permissions_system_tables.sql and
-- add_manage_roles_permission_keys.sql have already been applied. Staff
-- permission checks work without this migration too — they fall back to the
-- DEFAULT_STAFF_PERMS map in permission.middleware.ts — but owners won't see
-- these keys as togglable rows in Settings > Roles & Permissions until this
-- is applied.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_digital_menu',           'View Digital Menu',           'View the digital/QR menu dashboard',                      'Catalog', 'Digital Menu', 'view',   'low',    NULL),
  ('create_digital_menu',         'Create Digital Menu',         'Create the salon''s digital menu',                        'Catalog', 'Digital Menu', 'create', 'medium', ARRAY['view_digital_menu']),
  ('edit_digital_menu',           'Edit Digital Menu',           'Change the digital menu name and selected services',      'Catalog', 'Digital Menu', 'edit',   'medium', ARRAY['view_digital_menu']),
  ('manage_digital_menu_qr',      'Manage QR Code',              'View, download, print and share the menu QR code',        'Catalog', 'Digital Menu', 'manage', 'low',    ARRAY['view_digital_menu']),
  ('enable_disable_digital_menu', 'Enable/Disable Digital Menu', 'Turn the public digital menu on or off',                  'Catalog', 'Digital Menu', 'manage', 'medium', ARRAY['view_digital_menu'])
ON CONFLICT (key) DO NOTHING;
