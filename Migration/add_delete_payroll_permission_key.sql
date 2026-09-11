-- Adds a dedicated Delete Payroll entry permission, requested after the
-- original Payroll ticket (View Payroll/Add Salary Advance/Pay Salary/View
-- Payroll Details/Edit Payroll/Export Payroll) had already shipped — delete
-- was previously folded into edit_payroll with no separate toggle.
--
-- payroll.routes.ts's DELETE /:id route now requires
-- requireAnyPermission(["delete_payroll", "edit_payroll"]) — OR'd so a staff
-- member already granted Edit Payroll keeps their existing delete access
-- unchanged; an owner can now also grant Delete Payroll on its own. Salary
-- advance delete is untouched (still reuses add_salary_advance, matching the
-- original ticket — no separate "Delete Salary Advance" was asked for).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('delete_payroll', 'Delete Payroll', 'Permanently delete a payroll entry', 'Staff', 'Payroll', 'delete', 'high', ARRAY['view_payroll'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
