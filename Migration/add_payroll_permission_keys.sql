-- Re-adds the Payroll module's permission catalog rows, removed by
-- remove_payroll_permission_keys.sql when the old module was deleted.
-- Mirrors add_staff_module_permission_keys.sql's template — group_name
-- 'Payroll', module 'Staff', depends_on view_payroll for everything else.
--
-- Re-adds delete_payroll too (previously added standalone by
-- add_delete_payroll_permission_key.sql) so this one file fully restores the
-- module's permission set in one pass.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_payroll',          'View Payroll',          'Access pay runs and payroll data',                'Staff', 'Payroll', 'view',   'low',    NULL),
  ('view_payroll_details',  'View Payroll Details',  'View a single staff member''s payroll breakdown', 'Staff', 'Payroll', 'view',   'low',    ARRAY['view_payroll']),
  ('edit_payroll',          'Edit Payroll',          'Create/edit/delete a payroll entry',              'Staff', 'Payroll', 'edit',   'high',   ARRAY['view_payroll']),
  ('pay_salary',            'Pay Salary',            'Mark a payroll entry as paid',                    'Staff', 'Payroll', 'manage', 'high',   ARRAY['view_payroll']),
  ('add_salary_advance',    'Add Salary Advance',    'Record a salary advance for a staff member',      'Staff', 'Payroll', 'create', 'high',   ARRAY['view_payroll']),
  ('export_payroll',        'Export Payroll',        'Export payroll data',                             'Staff', 'Payroll', 'view',   'low',    ARRAY['view_payroll']),
  ('delete_payroll',        'Delete Payroll',        'Permanently delete a payroll entry',              'Staff', 'Payroll', 'delete', 'high',   ARRAY['view_payroll'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
