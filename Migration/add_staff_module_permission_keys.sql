-- Staff module permissions ticket (Staff List / Scheduled Shifts / Tip &
-- Commission / Attendance / Payroll / Staff History). view_team/
-- add_team_member/edit_team_member/view_payroll already existed and are
-- real; view_commissions/view_tips were ALSO already real and enforced on
-- routes but missing as catalog rows entirely — backfilled here since the
-- ticket's own Tip & Commission section explicitly names View Commission/
-- View Tip. manage_commissions/manage_payroll/view_wages/manage_wages/
-- manage_staff_personal_data were found in the same "enforced but never
-- catalogued" state but are NOT literally named by any of the 6 tickets
-- covered here — deliberately left OUT of the catalog (and off
-- DEFAULT_STAFF_PERMS) per explicit instruction: this effort only exposes
-- what a ticket actually asks for, not every pre-existing gap stumbled
-- into along the way. Tip & Commission's own Commission Rule CRUD and
-- Attendance/Payroll sections rely solely on their own dedicated keys, no
-- fallback to these older generic ones.
--
-- Staff List (group_name 'Staff List'): delete_staff/deactivate_staff/
-- import_staff/export_staff_* are OR'd as alternatives to the existing
-- edit_team_member/import_file/export_csv/export_excel on staff.routes.ts.
-- export_staff_pdf is frontend-only (no backend PDF export route exists,
-- matching the pre-existing client-only PDF export for this page). Several
-- of these routes (create/edit/activate/deactivate/delete/import/export)
-- were ALSO previously owner/admin-ONLY at the role layer — widened to
-- ownerAdminStaff so granting a staff member one of these keys is
-- meaningful.
--
-- Scheduled Shifts (group_name 'Scheduled Shifts'): view_scheduled_shifts/
-- add_working_hours/edit_working_hours/add_time_off/manage_day_off/
-- manage_blocked_day/copy_schedule. Several distinct UI actions share one
-- physical backend endpoint (PUT /:staffId/scheduled backs Working Hours,
-- Day Off, and Copy Schedule alike) — OR'd together as the backend
-- boundary; the frontend gates each button with its own specific key.
-- Blocked Times previously had NO permission check at all (role-only) —
-- closed via manage_blocked_day. Role widened from owner/admin to
-- ownerAdminStaff on the writes.
--
-- Tip & Commission (group_name 'Tip & Commission'): exactly the ticket's 11
-- — View Commission, Add/Edit/Delete Commission Rule, View Tip, Add/Edit/
-- Delete Tip, Export CSV/Excel/PDF. Commission Rule CRUD
-- (commissionRules.routes.ts) previously had NO permission check at all —
-- add_commission_rule/edit_commission_rule/delete_commission_rule close
-- that gap on their own, no fallback to manage_commissions. add_tip/delete_tip
-- are defined for completeness (ticket asks for the toggles) but have no
-- backend action to wire to — tips are auto-earned at checkout, never
-- manually created or deleted; edit_tip gates the one real tip mutation
-- (Settle Tip). download_commission_tip_* OR'd with generic export_csv/
-- excel/pdf on the commissions export route.
--
-- Attendance (group_name 'Attendance'): view_attendance_list/
-- view_attendance_rules close a module that had ZERO permission check at
-- all before this ticket (role-only throughout, `attendance.routes.ts`).
-- Attendance Rules covers both read and write (`/settings` GET+PUT) since
-- the ticket asks for one combined permission, not separate view/edit
-- ones. Manual mark/edit and check-in/out are out of scope (not named in
-- the ticket) and remain role-gated only, unchanged.
--
-- Payroll (group_name 'Payroll'): exactly the ticket's 6 — View Payroll,
-- Add Salary Advance, Pay Salary, View Payroll Details, Edit Payroll,
-- Export Payroll. manage_payroll (a pre-existing, already-enforced key not
-- named by the ticket) is deliberately NOT added — see
-- feedback_no_proactive_permission_backfill. view_payroll_details and
-- export_payroll are frontend-only (PayrollDetailsModal and export use
-- already-fetched list data, no dedicated backend route).
--
-- Staff History (group_name 'Staff History'): view_staff_history is a
-- DELIBERATE EXCEPTION to this app's usual "never hide, always show but
-- disable" rule — the ticket explicitly specifies Staff History is HIDDEN
-- from the Staff menu when this permission is off (not just disabled),
-- while direct URL access still shows Not Authorized. Edit Staff and
-- Activate Staff on the History detail page reuse the existing
-- edit_team_member and the new deactivate_staff keys respectively — no new
-- keys needed, they're the same actions as on the Staff List page.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- Backfill: real, enforced keys the Tip & Commission/Payroll tickets
  -- directly need but that were never inserted into the catalog
  ('view_commissions',             'View Commission',           'View commission earnings and settlements',        'Staff', 'Tip & Commission', 'view',   'low',    NULL),
  ('view_tips',                    'View Tip',                  'View tip earnings and settlements',               'Staff', 'Tip & Commission', 'view',   'low',    NULL),
  -- Staff List
  ('delete_staff',                 'Delete Staff',              'Permanently delete a staff member',               'Staff', 'Staff List', 'delete', 'high',   ARRAY['view_team']),
  ('deactivate_staff',             'Deactivate Staff',          'Activate or deactivate a staff member',           'Staff', 'Staff List', 'manage', 'medium', ARRAY['view_team']),
  ('import_staff',                 'Import Staff',              'Bulk-import staff from a file',                   'Staff', 'Staff List', 'manage', 'high',   ARRAY['view_team']),
  ('export_staff_csv',             'Export CSV',                'Download the Staff list as CSV',                  'Staff', 'Staff List', 'view',   'low',    ARRAY['view_team']),
  ('export_staff_excel',           'Export Excel',              'Download the Staff list as Excel',                'Staff', 'Staff List', 'view',   'low',    ARRAY['view_team']),
  ('export_staff_pdf',             'Export PDF',                'Download the Staff list as PDF',                  'Staff', 'Staff List', 'view',   'low',    ARRAY['view_team']),

  -- Scheduled Shifts
  ('view_scheduled_shifts',        'View Scheduled Shifts',     'Access the Scheduled Shifts page',                'Staff', 'Scheduled Shifts', 'view',   'low',    NULL),
  ('add_working_hours',            'Add Working Hours',         'Add a staff member''s working hours',             'Staff', 'Scheduled Shifts', 'create', 'medium', ARRAY['view_scheduled_shifts']),
  ('edit_working_hours',           'Edit Working Hours',        'Edit a staff member''s working hours',            'Staff', 'Scheduled Shifts', 'edit',   'medium', ARRAY['view_scheduled_shifts']),
  ('add_time_off',                 'Add Time Off',              'Add a time-off / leave entry for a staff member', 'Staff', 'Scheduled Shifts', 'create', 'medium', ARRAY['view_scheduled_shifts']),
  ('manage_day_off',               'Manage Day Off',            'Mark a day off for a staff member',               'Staff', 'Scheduled Shifts', 'manage', 'medium', ARRAY['view_scheduled_shifts']),
  ('manage_blocked_day',           'Manage Blocked Day',        'Block/unblock a time slot for a staff member',    'Staff', 'Scheduled Shifts', 'manage', 'medium', ARRAY['view_scheduled_shifts']),
  ('copy_schedule',                'Copy Schedule',             'Copy a schedule across days/staff',               'Staff', 'Scheduled Shifts', 'manage', 'medium', ARRAY['view_scheduled_shifts']),

  -- Tip & Commission
  ('add_commission_rule',          'Add Commission Rule',       'Create a new commission rule',                    'Staff', 'Tip & Commission', 'create', 'medium', ARRAY['view_commissions']),
  ('edit_commission_rule',         'Edit Commission Rule',      'Edit an existing commission rule',                'Staff', 'Tip & Commission', 'edit',   'medium', ARRAY['view_commissions']),
  ('delete_commission_rule',       'Delete Commission Rule',    'Permanently delete a commission rule',            'Staff', 'Tip & Commission', 'delete', 'high',   ARRAY['view_commissions']),
  ('add_tip',                      'Add Tip',                   'Manually add a tip record',                       'Staff', 'Tip & Commission', 'create', 'medium', ARRAY['view_tips']),
  ('edit_tip',                     'Edit Tip',                  'Edit/settle a staff member''s tip',               'Staff', 'Tip & Commission', 'edit',   'medium', ARRAY['view_tips']),
  ('delete_tip',                   'Delete Tip',                'Permanently delete a tip record',                 'Staff', 'Tip & Commission', 'delete', 'high',   ARRAY['view_tips']),
  ('download_commission_tip_csv',  'Export CSV',                'Download commission/tip data as CSV',             'Staff', 'Tip & Commission', 'view',   'low',    NULL),
  ('download_commission_tip_excel','Export Excel',              'Download commission/tip data as Excel',           'Staff', 'Tip & Commission', 'view',   'low',    NULL),
  ('download_commission_tip_pdf',  'Export PDF',                'Download commission/tip data as PDF',             'Staff', 'Tip & Commission', 'view',   'low',    NULL),

  -- Attendance
  ('view_attendance_list',         'View Attendance List',      'Access the Attendance List/Page',                 'Staff', 'Attendance', 'view',   'low',    NULL),
  ('view_attendance_rules',        'View Attendance Rules',     'Access and manage Attendance Rules',              'Staff', 'Attendance', 'manage', 'medium', NULL),

  -- Payroll
  ('add_salary_advance',           'Add Salary Advance',        'Record a salary advance for a staff member',      'Staff', 'Payroll', 'create', 'high',   ARRAY['view_payroll']),
  ('pay_salary',                   'Pay Salary',                'Mark a payroll entry as paid',                    'Staff', 'Payroll', 'manage', 'high',   ARRAY['view_payroll']),
  ('view_payroll_details',         'View Payroll Details',      'View a single staff member''s payroll breakdown', 'Staff', 'Payroll', 'view',   'low',    ARRAY['view_payroll']),
  ('edit_payroll',                 'Edit Payroll',               'Create/edit/delete a payroll entry',             'Staff', 'Payroll', 'edit',   'high',   ARRAY['view_payroll']),
  ('export_payroll',               'Export Payroll',            'Export payroll data',                             'Staff', 'Payroll', 'view',   'low',    ARRAY['view_payroll']),

  -- Staff History
  ('view_staff_history',           'View Staff History',        'View a staff member''s history detail page',      'Staff', 'Staff History', 'view',   'low',    NULL)
ON CONFLICT (key) DO NOTHING;

-- Corrects group_name on keys that pre-date this ticket and were seeded
-- with group_name IS NULL (create_permissions_system_tables.sql) — an
-- INSERT ... ON CONFLICT DO NOTHING can never fix an already-existing row's
-- group_name, so these were landing in an ungrouped "General" bucket in the
-- Roles & Permissions UI, an unintended 7th section alongside this ticket's
-- 6 (Staff List/Scheduled Shifts/Tip & Commission/Attendance/Payroll/Staff
-- History). Idempotent — safe to re-run.
UPDATE permissions SET group_name = 'Staff List' WHERE module = 'Staff' AND key IN ('view_team', 'add_team_member', 'edit_team_member');
UPDATE permissions SET group_name = 'Scheduled Shifts' WHERE module = 'Staff' AND key = 'manage_shifts';
UPDATE permissions SET group_name = 'Payroll' WHERE module = 'Staff' AND key = 'view_payroll';

COMMIT;
