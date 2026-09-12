-- Enquiries permissions ticket: Settings → Roles & Permissions → Enquiries
-- must expose 4 independent controls — View Enquiries List, Add Enquiry,
-- Edit Enquiry, Delete Enquiry. respond_enquiries (which bundled create+
-- update into one key) is split into add_enquiries and edit_enquiries,
-- each independently toggleable, matching delete_enquiries's existing
-- granularity.
--
-- Per the "delete old, implement new" rule, respond_enquiries is fully
-- removed, not left as a parallel/legacy path — but per "backfill the
-- replacement first" (any existing grant must survive the split), any role
-- or staff override that already had respond_enquiries granted gets both
-- add_enquiries AND edit_enquiries granted with the same value before the
-- old key is deleted, so nobody's access silently changes.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

-- 1. Add the two new catalog permissions.
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on)
VALUES
  ('add_enquiries', 'Add Enquiry', 'Create a new client enquiry', 'Enquiries', NULL, 'create', 'low', ARRAY['view_enquiries']),
  ('edit_enquiries', 'Edit Enquiry', 'Edit an enquiry, change its status, or set a follow-up', 'Enquiries', NULL, 'edit', 'low', ARRAY['view_enquiries'])
ON CONFLICT (key) DO NOTHING;

-- 2. Backfill: any existing role grant for respond_enquiries carries over to
--    both new keys.
INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'add_enquiries', allowed FROM role_permissions WHERE permission_key = 'respond_enquiries'
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'edit_enquiries', allowed FROM role_permissions WHERE permission_key = 'respond_enquiries'
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- 3. Backfill: same for per-staff overrides.
INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed)
SELECT staff_id, 'add_enquiries', allowed FROM staff_permission_overrides WHERE permission_key = 'respond_enquiries'
ON CONFLICT (staff_id, permission_key) DO NOTHING;

INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed)
SELECT staff_id, 'edit_enquiries', allowed FROM staff_permission_overrides WHERE permission_key = 'respond_enquiries'
ON CONFLICT (staff_id, permission_key) DO NOTHING;

-- 4. Remove respond_enquiries entirely (code no longer references it — see
--    enquiries.routes.ts).
UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'respond_enquiries';
DELETE FROM role_permissions WHERE permission_key = 'respond_enquiries';
DELETE FROM staff_permission_overrides WHERE permission_key = 'respond_enquiries';
DELETE FROM permissions WHERE key = 'respond_enquiries';

COMMIT;
