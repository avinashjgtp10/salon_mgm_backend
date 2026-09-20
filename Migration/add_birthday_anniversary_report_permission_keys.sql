-- Adds View/Download permission keys for the two new Marketing reports —
-- Birthday Report and Anniversary Report — following the exact key-naming
-- and structure convention set by add_individual_report_permission_keys.sql
-- (view_report_<id> / download_report_<id>, <id> matching REPORTS[] in
-- ReportsPage.tsx: "birthday", "anniversary"). display_order continues on
-- from set_report_permission_display_order.sql's last Marketing values
-- (view_report_membership_opportunity=15, download=16).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod), after both of the two
-- migrations above.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_report_birthday',      'Birthday Report — View',      'View the Birthday Report',      'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_birthday',  'Birthday Report — Download',  'Download the Birthday Report',  'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_birthday']),
  ('view_report_anniversary',     'Anniversary Report — View',     'View the Anniversary Report',     'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_anniversary', 'Anniversary Report — Download', 'Download the Anniversary Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_anniversary']);

UPDATE permissions SET display_order = 17 WHERE key = 'view_report_birthday';
UPDATE permissions SET display_order = 18 WHERE key = 'download_report_birthday';
UPDATE permissions SET display_order = 19 WHERE key = 'view_report_anniversary';
UPDATE permissions SET display_order = 20 WHERE key = 'download_report_anniversary';

COMMIT;
