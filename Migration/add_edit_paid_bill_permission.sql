-- Calendar: "Edit Paid Bill" permission (ON/OFF toggle in Settings -> Roles &
-- Permissions -> Calendar).
--   ON  : staff/role users can edit an appointment whose bill is already paid.
--   OFF : they cannot (owners/admins always can).
-- Enforced server-side by requirePaidBillEditPermission on
-- PATCH /api/v1/appointments/:id (appointments.guards.ts), and mirrored in the
-- UI (ViewBillModal's Edit action, AppointmentModal's Update button).
--
-- Depends on edit_appointment: it only means something for someone who can
-- edit appointments at all.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order. Idempotent — safe to
-- re-run.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on, display_order) VALUES
  ('edit_paid_bill', 'Edit Paid Bill',
   'Edit an appointment whose bill has already been paid',
   'Calendar', NULL, 'edit', 'high', ARRAY['edit_appointment'], 7)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  depends_on = EXCLUDED.depends_on;

-- ── Keep today's behaviour for existing roles/staff (OPTIONAL — see note) ────
-- Until now anyone with edit_appointment could edit a paid bill. With no grant
-- rows, every staff role would lose that the moment this ships, since a key
-- with no role_permissions row resolves to "not allowed". These two statements
-- carry the current access over to the new key, so nothing changes until an
-- owner switches Edit Paid Bill OFF for a role/staff member.
-- Delete both statements to ship the toggle OFF for everyone instead.
INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT role_id, 'edit_paid_bill', TRUE
FROM role_permissions
WHERE permission_key = 'edit_appointment' AND allowed = TRUE
ON CONFLICT (role_id, permission_key) DO NOTHING;

INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed, set_by)
SELECT staff_id, 'edit_paid_bill', TRUE, set_by
FROM staff_permission_overrides
WHERE permission_key = 'edit_appointment' AND allowed = TRUE
ON CONFLICT (staff_id, permission_key) DO NOTHING;

COMMIT;
