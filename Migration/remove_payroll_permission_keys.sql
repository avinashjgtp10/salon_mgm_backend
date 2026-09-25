-- Removes the Payroll module's permission catalog rows — the Payroll page,
-- its route, its nav entries, and its backend module (src/modules/payroll)
-- are being deleted outright, so these keys have nothing left to gate:
-- view_payroll, view_payroll_details, edit_payroll, delete_payroll,
-- export_payroll, add_salary_advance, pay_salary.
--
-- Does NOT touch view_report_payroll_history / download_report_payroll_history
-- — those belong to the separate "Payroll History Report" under
-- Analytics/Reports, which is staying.
--
-- Does NOT touch manage_payroll/view_wages/manage_wages — those pre-date the
-- Payroll ticket, were already removed from the catalog by
-- remove_staff_wages_personal_data_permission_keys.sql, and view_wages is
-- still actively enforced by staff.routes.ts's wages routes (unrelated to
-- this module removal).
--
-- Does NOT drop the payroll_entries / payroll_salary_advances tables — this
-- migration only touches the permissions catalog, never DB schema/data.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log
SET permission_key = NULL
WHERE permission_key IN (
  'view_payroll', 'view_payroll_details', 'edit_payroll', 'delete_payroll',
  'export_payroll', 'add_salary_advance', 'pay_salary'
);

DELETE FROM role_permissions
WHERE permission_key IN (
  'view_payroll', 'view_payroll_details', 'edit_payroll', 'delete_payroll',
  'export_payroll', 'add_salary_advance', 'pay_salary'
);

DELETE FROM staff_permission_overrides
WHERE permission_key IN (
  'view_payroll', 'view_payroll_details', 'edit_payroll', 'delete_payroll',
  'export_payroll', 'add_salary_advance', 'pay_salary'
);

DELETE FROM permissions
WHERE key IN (
  'view_payroll', 'view_payroll_details', 'edit_payroll', 'delete_payroll',
  'export_payroll', 'add_salary_advance', 'pay_salary'
);

COMMIT;
