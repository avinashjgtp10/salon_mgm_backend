-- Removes view_wages/manage_wages/manage_staff_personal_data/manage_payroll
-- — all four were backfilled into the catalog by an earlier draft of
-- add_staff_module_permission_keys.sql (real, already-enforced keys that
-- had never been inserted as catalog rows), but NONE of them are literally
-- named by the 6 Staff module tickets (Staff List/Scheduled Shifts/Tip &
-- Commission/Attendance/Payroll/Staff History) and were cluttering their
-- sections with unrelated toggles — Payroll's ticket names exactly View
-- Payroll/Add Salary Advance/Pay Salary/View Payroll Details/Edit Payroll/
-- Export Payroll, nothing else. Explicit instruction: only expose what a
-- ticket actually asks for (see feedback_no_proactive_permission_backfill).
--
-- Removing a catalog row does NOT reopen its underlying route — it still
-- calls requirePermission("manage_payroll") etc. wherever that string is
-- still referenced in code (payroll.routes.ts's own OR-fallback to
-- manage_payroll was also removed in this same pass), so this just falls
-- through to `?? false` for staff — the same closed-by-default state these
-- routes were in before any catalog row for them ever existed. Owner/admin
-- are unaffected (unconditional bypass).
--
-- Safe to run whether or not the earlier draft was ever applied — the
-- DELETEs are no-ops if these rows don't exist.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log
SET permission_key = NULL
WHERE permission_key IN ('view_wages', 'manage_wages', 'manage_staff_personal_data', 'manage_payroll');

DELETE FROM role_permissions
WHERE permission_key IN ('view_wages', 'manage_wages', 'manage_staff_personal_data', 'manage_payroll');

DELETE FROM staff_permission_overrides
WHERE permission_key IN ('view_wages', 'manage_wages', 'manage_staff_personal_data', 'manage_payroll');

DELETE FROM permissions
WHERE key IN ('view_wages', 'manage_wages', 'manage_staff_personal_data', 'manage_payroll');

COMMIT;
