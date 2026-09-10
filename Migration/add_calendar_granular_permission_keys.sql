-- Calendar permissions — final state (rewritten to match what was actually
-- applied to dev via one-off scripts in a separate session, so this file
-- reaches the same end state in one shot on any environment that hasn't
-- been touched yet, e.g. QA/prod).
--
-- Splits the old single manage_calendar key into independently controllable
-- actions, sets an explicit display order for the whole Calendar group, and
-- removes manage_calendar. record_payment was folded into create_appointment
-- (renamed "Create Appointment & Record Payment") rather than kept as its
-- own key — creating an appointment and recording payment on it are treated
-- as one action.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order. Already
-- applied to dev directly — safe to run here too (idempotent), but running
-- it again there is a no-op.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_appointment',     'View Appointment',                    'Open an appointment''s details',                        'Calendar', NULL, 'view',   'low',    ARRAY['view_calendar']),
  ('create_appointment',   'Create Appointment & Record Payment', 'Create new appointments and block time, and open the payment flow to record a payment on an appointment', 'Calendar', NULL, 'create', 'medium', ARRAY['view_calendar']),
  ('edit_appointment',     'Edit Appointment',                    'Edit appointments, including drag/resize rescheduling', 'Calendar', NULL, 'edit',   'medium', ARRAY['view_appointment']),
  ('cancel_appointment',   'Cancel Appointment',                  'Cancel a booked appointment',                           'Calendar', NULL, 'manage', 'medium', ARRAY['view_appointment']),
  ('delete_appointment',   'Delete Appointment',                  'Permanently delete an appointment',                     'Calendar', NULL, 'delete', 'high',   ARRAY['view_appointment']),
  ('view_payment_details', 'View Payment Details',                'View, print or send an appointment''s receipt',         'Calendar', NULL, 'view',   'medium', ARRAY['view_appointment'])
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- Explicit display order for the Calendar group (used by
-- roles.repository.ts's listPermissions query instead of the default
-- alphabetical-by-action ordering).
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS display_order INTEGER;
UPDATE permissions SET display_order = 1 WHERE key = 'view_calendar';
UPDATE permissions SET display_order = 2 WHERE key = 'view_appointment';
UPDATE permissions SET display_order = 3 WHERE key = 'create_appointment';
UPDATE permissions SET display_order = 4 WHERE key = 'edit_appointment';
UPDATE permissions SET display_order = 5 WHERE key = 'cancel_appointment';
UPDATE permissions SET display_order = 6 WHERE key = 'delete_appointment';
UPDATE permissions SET display_order = 8 WHERE key = 'view_payment_details';
-- (7 is deliberately skipped — record_payment used to occupy it before
-- being merged into create_appointment; leaving the gap rather than
-- renumbering keeps this file a faithful record of what actually happened.)

-- manage_calendar is now fully superseded by the keys above — remove it and
-- anything referencing it by key.
UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'manage_calendar';
DELETE FROM role_permissions WHERE permission_key = 'manage_calendar';
DELETE FROM staff_permission_overrides WHERE permission_key = 'manage_calendar';
DELETE FROM permissions WHERE key = 'manage_calendar';

COMMIT;
