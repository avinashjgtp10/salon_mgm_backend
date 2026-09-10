-- Roles & Permissions system — Import/Export File permissions.
-- Previously import/export actions were gated (where gated at all) only by
-- a module's existing view/create permission, with no way to grant or deny
-- the import/export action itself independently. This adds one system-wide
-- Import File permission and three system-wide Export permissions (one per
-- file format), layered ON TOP OF each module's existing permission check —
-- a staff member still needs the module's own view/create permission AND
-- the matching import/export key, matching the pattern already used for
-- manage_integrations on top of general_settings.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment, after create_permissions_system_tables.sql,
-- add_manage_roles_permission_keys.sql and add_gap_closure_permission_keys.sql
-- have already been applied.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('import_file',   'Import File',        'Bulk-import records from an uploaded file (Clients, Products, Services, Staff, Sales)', 'System', 'Import & Export', 'manage', 'high', NULL),
  ('export_csv',    'Export as CSV',      'Download records as a CSV file',    'System', 'Import & Export', 'view', 'medium', NULL),
  ('export_excel',  'Export as Excel',    'Download records as an Excel file', 'System', 'Import & Export', 'view', 'medium', NULL),
  ('export_pdf',    'Export as PDF',      'Download records as a PDF file',    'System', 'Import & Export', 'view', 'medium', NULL)
ON CONFLICT (key) DO NOTHING;
