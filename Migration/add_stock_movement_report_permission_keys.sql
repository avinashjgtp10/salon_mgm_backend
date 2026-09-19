-- Adds View/Download permission keys for the new Stock Movement Report
-- (POST /api/report/stock-movement), following the exact convention set by
-- add_individual_report_permission_keys.sql: module='Reports',
-- group_name='Inventory', key = view_report_<id>/download_report_<id> where
-- <id> matches ReportDef.id ("stock_movement") in ReportsPage.tsx.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_report_stock_movement',     'Stock Movement Report — View',     'View the Stock Movement Report',     'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_stock_movement', 'Stock Movement Report — Download', 'Download the Stock Movement Report', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_stock_movement'])
ON CONFLICT (key) DO NOTHING;
