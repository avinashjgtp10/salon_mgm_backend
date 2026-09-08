-- Roles & Permissions system (Phase 3 — Gap Closures).
-- New permission keys needed to close the enforcement gaps found during the
-- investigation: modules with no requirePermission() check at all (Cash
-- Management, Client Packages/Memberships, Suppliers, Payroll, Wages,
-- Commissions, Tips, Staff personal data, WhatsApp Automation, Coupons),
-- overloaded keys being split (Products/Packages/Memberships edit vs
-- delete, Enquiries respond vs delete), and credentials being separated
-- from lower-risk settings (WhatsApp config, third-party integrations).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment, after create_permissions_system_tables.sql
-- and add_manage_roles_permission_keys.sql have already been applied.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('edit_products',                   'Edit Products',                   'Modify existing product details and pricing',                          'Catalog',   'Products',    'edit',   'medium',   ARRAY['view_products']),
  ('delete_products',                 'Delete Products',                 'Remove products from the catalog',                                      'Catalog',   'Products',    'delete', 'high',     ARRAY['view_products']),
  ('edit_packages',                   'Edit Packages',                   'Modify existing service packages',                                      'Catalog',   'Packages',    'edit',   'medium',   ARRAY['view_packages']),
  ('delete_packages',                 'Delete Packages',                 'Remove service packages',                                               'Catalog',   'Packages',    'delete', 'high',     ARRAY['view_packages']),
  ('edit_memberships',                'Edit Memberships',                'Modify existing membership plans',                                      'Catalog',   'Memberships', 'edit',   'medium',   ARRAY['view_memberships']),
  ('delete_memberships',              'Delete Memberships',              'Remove membership plans',                                               'Catalog',   'Memberships', 'delete', 'high',     ARRAY['view_memberships']),
  ('view_cash_management',            'View Cash Management',            'See the cash register, transactions and expenses',                     'Cash Management', NULL,     'view',   'medium',   NULL),
  ('manage_cash_register',            'Manage Cash Register',            'Open and close the cash register with reconciliation',                 'Cash Management', NULL,     'manage', 'high',     ARRAY['view_cash_management']),
  ('manage_cash_transactions',        'Manage Cash Transactions',        'Add, edit and delete cash expense entries',                             'Cash Management', NULL,     'manage', 'high',     ARRAY['view_cash_management']),
  ('manage_client_purchase_history',  'Manage Client Purchase History',  'View and manage client purchased packages and memberships',            'Clients',   NULL,          'manage', 'high',     ARRAY['view_clients']),
  ('manage_suppliers',                'Manage Suppliers',                'Create, edit and delete suppliers and record supplier payments',       'Catalog',   'Inventory',   'manage', 'high',     ARRAY['view_inventory']),
  ('manage_payroll',                  'Manage Payroll',                  'Create, edit and process payroll entries and salary advances',         'Staff',     NULL,          'manage', 'critical', ARRAY['view_payroll']),
  ('view_wages',                      'View Wages',                     'See staff hourly rate and salary information',                          'Staff',     NULL,          'view',   'high',     NULL),
  ('manage_wages',                    'Manage Wages',                    'Edit staff hourly rate and salary settings',                            'Staff',     NULL,          'manage', 'critical', ARRAY['view_wages']),
  ('view_commissions',                'View Commissions',                'See staff commission settings, rules and earned amounts',              'Staff',     NULL,          'view',   'medium',   NULL),
  ('manage_commissions',              'Manage Commissions',              'Edit commission settings and rules, and settle commissions',            'Staff',     NULL,          'manage', 'high',     ARRAY['view_commissions']),
  ('view_tips',                       'View Tips',                       'See staff tip summaries and earned amounts',                            'Staff',     NULL,          'view',   'medium',   NULL),
  ('manage_tips',                     'Manage Tips',                     'Settle staff tips',                                                     'Staff',     NULL,          'manage', 'high',     ARRAY['view_tips']),
  ('manage_staff_personal_data',      'Manage Staff Personal Data',      'View and edit staff addresses, emergency contacts, schedules and leaves', 'Staff',   NULL,          'manage', 'high',     ARRAY['view_team']),
  ('manage_whatsapp_config',          'Manage WhatsApp Config',          'Connect and manage WhatsApp Business API credentials',                  'Marketing', NULL,          'manage', 'critical', NULL),
  ('view_wa_automation',              'View WhatsApp Automation',        'See automated WhatsApp message logs and scheduled sends',               'Marketing', 'Automation',  'view',   'medium',   NULL),
  ('manage_wa_automation',            'Manage WhatsApp Automation',      'Configure automation triggers and manage scheduled sends',              'Marketing', 'Automation',  'manage', 'high',     ARRAY['view_wa_automation']),
  ('view_coupons',                    'View Coupons',                    'See discount coupons',                                                  'Marketing', NULL,          'view',   'low',      NULL),
  ('manage_coupons',                  'Manage Coupons',                  'Create, edit and delete discount coupons',                              'Marketing', NULL,          'manage', 'medium',   ARRAY['view_coupons']),
  ('respond_enquiries',               'Respond to Enquiries',            'Update enquiry status and follow-ups',                                  'Enquiries', NULL,          'edit',   'medium',   ARRAY['view_enquiries']),
  ('delete_enquiries',                'Delete Enquiries',                'Remove enquiry records',                                                'Enquiries', NULL,          'delete', 'high',     ARRAY['view_enquiries']),
  ('manage_integrations',             'Manage Integrations',             'Connect and manage third-party API credentials (payment, SMS, email)', 'Settings',  NULL,          'manage', 'critical', NULL),
  ('view_branches',                   'View Branches',                   'See branch locations, hours and holidays',                              'Settings',  NULL,          'view',   'low',      NULL),
  ('manage_branches',                 'Manage Branches',                 'Create and edit branches, timings and holidays',                       'Settings',  NULL,          'manage', 'high',     ARRAY['view_branches']),
  ('view_dashboard_financials',       'View Dashboard Financials',       'See revenue figures on the dashboard',                                  'Dashboard', NULL,          'view',   'medium',   ARRAY['view_dashboard']),
  ('view_dashboard_staff_performance','View Dashboard Staff Performance','See per-staff revenue and ranking on the dashboard',                    'Dashboard', NULL,          'view',   'medium',   ARRAY['view_dashboard']),
  ('view_dashboard_client_info',      'View Dashboard Client Info',      'See client birthday and contact info on the dashboard',                 'Dashboard', NULL,          'view',   'low',      ARRAY['view_dashboard'])
ON CONFLICT (key) DO NOTHING;
