-- Roles & Permissions system (Phase 2 — API).
-- Adds the two permission keys that gate the new /api/v1/roles and
-- /api/v1/staff/:id/permissions endpoints (Migration/create_permissions_system_tables.sql's
-- Phase 1 seed predates this ticket and doesn't include them).
--
-- This is the fix for the original problem the whole redesign started from:
-- editing the salon's staff permission matrix used to be gated only by
-- `general_settings` (a permission meant for things like business hours),
-- so anyone granted that could silently rewrite who has access to what,
-- including granting themselves more. `manage_roles`/`view_roles` are now
-- the ONLY keys that gate role/permission management. Note: the generic
-- settings endpoint (settings.controller.ts) still special-cases the
-- `role_permissions` salon_settings key today — closing that loophole
-- fully is separate Security Bug ticket #50, not part of this migration.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod), after
-- create_permissions_system_tables.sql has already been applied.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_roles',   'View Roles',   'See the list of roles and staff permission assignments', 'Settings', 'Roles & Permissions', 'view',   'medium',   NULL),
  ('manage_roles', 'Manage Roles', 'Create, edit and delete roles; assign roles to staff; edit individual staff permission overrides', 'Settings', 'Roles & Permissions', 'manage', 'critical', ARRAY['view_roles'])
ON CONFLICT (key) DO NOTHING;
