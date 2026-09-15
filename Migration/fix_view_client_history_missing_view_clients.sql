-- view_client_history has always depended on view_clients (Client History
-- is a drill-down of a client's record, meaningless without seeing the
-- client itself), but that dependency was only enforced as an "auto-enable
-- the prerequisite when you toggle the child on" nudge in the Roles &
-- Permissions editors — and that cascade logic didn't exist at all in one
-- of the three editors (Staff Management's modal) until a later fix this
-- project. Any override/role saved through it before that point could end
-- up with view_client_history = true and view_clients = false — exactly
-- reproduced on dev right now for one staff override, which is what caused
-- "Permission Required (view_clients)" everywhere (Calendar, Client List)
-- despite View Client History being explicitly turned on for them.
--
-- Going forward this exact inconsistency can no longer be *saved* — see
-- permissionCascade.ts's findMissingPrerequisites, wired into all three
-- editors' Save handlers — but existing bad rows need this one-time fix.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'view_clients', true
FROM role_permissions
WHERE permission_key = 'view_client_history' AND allowed = true
  AND role_id NOT IN (
    SELECT role_id FROM role_permissions WHERE permission_key = 'view_clients'
  );

UPDATE role_permissions SET allowed = true
WHERE permission_key = 'view_clients' AND allowed = false
  AND role_id IN (
    SELECT role_id FROM role_permissions WHERE permission_key = 'view_client_history' AND allowed = true
  );

INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed)
SELECT staff_id, 'view_clients', true
FROM staff_permission_overrides
WHERE permission_key = 'view_client_history' AND allowed = true
  AND staff_id NOT IN (
    SELECT staff_id FROM staff_permission_overrides WHERE permission_key = 'view_clients'
  );

UPDATE staff_permission_overrides SET allowed = true
WHERE permission_key = 'view_clients' AND allowed = false
  AND staff_id IN (
    SELECT staff_id FROM staff_permission_overrides WHERE permission_key = 'view_client_history' AND allowed = true
  );

COMMIT;
