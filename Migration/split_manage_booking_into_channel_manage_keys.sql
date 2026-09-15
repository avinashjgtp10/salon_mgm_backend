-- Online Booking permissions ticket, follow-up: manage_booking's entire
-- real function was always just "can write to the Marketplace channel" (its
-- only checks live in marketplace.routes.ts — Link Builder's write routes
-- were role-only/ungated, Reserve with Google and Facebook & Instagram are
-- static mockup pages with no write actions at all). Per "delete old,
-- implement new," it's replaced outright rather than kept as a parallel
-- path:
--   - manage_marketplace takes over its exact scope (marketplace.routes.ts).
--   - manage_link_builder is a genuinely NEW gate for Link Builder's
--     generate/save/delete routes, which had no permission check before.
--   - No manage key added for Reserve with Google / Facebook & Instagram —
--     both are read-only "coming soon" pages with nothing to manage.
--
-- Backfills any existing manage_booking grant into manage_marketplace
-- first (dev has zero live grants, but QA/prod aren't assumed to match).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on)
VALUES
  ('manage_marketplace', 'Manage Marketplace', 'Edit the Marketplace profile, images, and publish/unpublish it', 'Online Booking', 'Channels', 'edit', 'medium', ARRAY['view_marketplace']),
  ('manage_link_builder', 'Manage Link Builder', 'Generate, save, and delete booking links', 'Online Booking', 'Channels', 'edit', 'low', ARRAY['view_link_builder'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'manage_marketplace', allowed FROM role_permissions WHERE permission_key = 'manage_booking'
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed)
SELECT staff_id, 'manage_marketplace', allowed FROM staff_permission_overrides WHERE permission_key = 'manage_booking'
ON CONFLICT (staff_id, permission_key) DO NOTHING;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'manage_booking';
DELETE FROM role_permissions WHERE permission_key = 'manage_booking';
DELETE FROM staff_permission_overrides WHERE permission_key = 'manage_booking';
DELETE FROM permissions WHERE key = 'manage_booking';

COMMIT;
