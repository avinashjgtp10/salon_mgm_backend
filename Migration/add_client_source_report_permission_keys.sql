-- Adds View/Download permission keys for the new Client Source Report
-- (POST /api/report/client-source), following the convention set by
-- add_individual_report_permission_keys.sql: module='Reports',
-- group_name='Clients', key = view_report_<id>/download_report_<id> where
-- <id> matches ReportDef.id ("client_source") in ReportsPage.tsx.
--
-- Run this BEFORE deploying the backend: the route is guarded by
-- view_report_client_source, which only owner/admin can pass until the key exists.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_report_client_source',     'Client Source Report — View',     'View the Client Source Report',     'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_client_source', 'Client Source Report — Download', 'Download the Client Source Report', 'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_client_source'])
ON CONFLICT (key) DO NOTHING;
