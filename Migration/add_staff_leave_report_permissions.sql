-- Staff Leave Report: View + Download permissions (same shape as the other Staff reports in
-- add_individual_report_permission_keys.sql). Report id: staff_leave_report.
-- Per project policy this is NOT auto-run; apply it by hand against each environment. Safe to re-run.
-- Until it is applied, owners/admins still see the report; staff members need view_scheduled_shifts or the new key.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_report_staff_leave_report',     'Staff Leave Report — View',     'View the Staff Leave Report',     'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_staff_leave_report', 'Staff Leave Report — Download', 'Download the Staff Leave Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_staff_leave_report'])
ON CONFLICT (key) DO NOTHING;
