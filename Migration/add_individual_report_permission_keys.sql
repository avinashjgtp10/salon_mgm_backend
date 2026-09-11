-- "Add Individual View & Download Permissions for All Reports" ticket.
-- Adds a View Report + Download permission for each of the 53 reports in
-- Settings → Roles & Permissions → Reports, plus one parent permission per
-- category (Sales/Payments/Clients/Appointments/Inventory/Staff/Package &
-- Membership/Marketing). module='Reports', group_name=category — mirrors
-- every other module's structure this session.
--
-- Key naming: view_report_<id> / download_report_<id>, where <id> is the
-- exact `id` field from ReportDef in ReportsPage.tsx (the frontend's own
-- stable identifier for each report — NOT the URL slug, which differs from
-- the id for several reports, e.g. GST Report's id is "taxes").
--
-- Three reports appear under two categories in the ticket (Product Retail
-- Report: Sales+Inventory; Product Margin Report: Sales+Inventory; Client
-- Rating Report/Marketing Feedback & Ratings: Clients+Marketing) — same
-- backend data/component, but per explicit instruction these get
-- INDEPENDENT toggles per category, not one shared key. This maps exactly
-- onto REPORTS[] in ReportsPage.tsx, which already carries two distinct ids
-- for each of these three (e.g. "product_sale" for the Sales listing,
-- "product_sale_inventory" for the Inventory listing) — so no new id
-- scheme was invented, this just catalogues what already exists.
--
-- Backend wiring: reports.routes.ts/legacyReports.routes.ts now check
-- view_report_<id> per-route in place of the old shared view_reports check
-- (see those files). Five reports (Consumable Usage, Supplier Report,
-- Supplier Purchase History, Commission Report, Attendance Report) have no
-- dedicated report endpoint — they reuse existing feature-module routes
-- (Suppliers, Product Inventory Purchases, Stock Reconciliation, Staff
-- Commissions, Attendance) — their new keys are OR'd alongside the existing
-- feature permission on those shared routes (see
-- inventory.routes.ts/staff.routes.ts/attendance.routes.ts) per explicit
-- instruction, rather than building 5 new dedicated endpoints.
--
-- view_reports (existing, unchanged) becomes the umbrella "can enter the
-- Reports section at all" gate — see view_reports VIRTUAL_PERMS entry in
-- usePermissions.ts (OR of all 8 view_reports_<category> keys), same
-- pattern as view_marketing for the Marketing ticket.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- ── Category parents ──────────────────────────────────────────────────────
  ('view_reports_sales',      'Sales Reports',                'Access the Sales report category',                'Reports', 'Sales',                  'view', 'low', ARRAY['view_reports']),
  ('view_reports_payments',   'Payments Reports',             'Access the Payments report category',             'Reports', 'Payments',               'view', 'low', ARRAY['view_reports']),
  ('view_reports_customers',  'Clients Reports',               'Access the Clients report category',              'Reports', 'Clients',                'view', 'low', ARRAY['view_reports']),
  ('view_reports_appointments', 'Appointments Reports',       'Access the Appointments report category',         'Reports', 'Appointments',           'view', 'low', ARRAY['view_reports']),
  ('view_reports_inventory',  'Inventory Reports',            'Access the Inventory report category',            'Reports', 'Inventory',              'view', 'low', ARRAY['view_reports']),
  ('view_reports_staff',      'Staff Reports',                'Access the Staff report category',                'Reports', 'Staff',                  'view', 'low', ARRAY['view_reports']),
  ('view_reports_packages',   'Package & Membership Reports', 'Access the Package & Membership report category', 'Reports', 'Package & Membership',  'view', 'low', ARRAY['view_reports']),
  ('view_reports_marketing',  'Marketing Reports',            'Access the Marketing report category',            'Reports', 'Marketing',              'view', 'low', ARRAY['view_reports']),

  -- ── Sales (8 reports) ─────────────────────────────────────────────────────
  ('view_report_sales_summary',     'Sales Summary Report — View',     'View the Sales Summary Report',     'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_sales_summary', 'Sales Summary Report — Download', 'Download the Sales Summary Report', 'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_sales_summary']),
  ('view_report_daily_sheet',       'Daily Sheet Report — View',       'View the Daily Sheet Report',       'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_daily_sheet',   'Daily Sheet Report — Download',   'Download the Daily Sheet Report',   'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_daily_sheet']),
  ('view_report_product_sale',      'Product Retail Report — View',     'View the Product Retail Report (Sales)',     'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_product_sale',  'Product Retail Report — Download', 'Download the Product Retail Report (Sales)', 'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_product_sale']),
  ('view_report_service_sale',      'Service Sale Report — View',      'View the Service Sale Report',      'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_service_sale',  'Service Sale Report — Download',  'Download the Service Sale Report',  'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_service_sale']),
  ('view_report_taxes',             'GST Report — View',               'View the GST Report',               'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_taxes',         'GST Report — Download',           'Download the GST Report',           'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_taxes']),
  ('view_report_product_margin',     'Product Margin Report — View',     'View the Product Margin Report (Sales)',     'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_product_margin', 'Product Margin Report — Download', 'Download the Product Margin Report (Sales)', 'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_product_margin']),
  ('view_report_reward',            'Reward Report — View',            'View the Reward Report',            'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_reward',        'Reward Report — Download',        'Download the Reward Report',        'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_reward']),
  ('view_report_ewallet',           'Ewallet Report — View',           'View the Ewallet Report',           'Reports', 'Sales', 'view',   'low',    ARRAY['view_reports_sales']),
  ('download_report_ewallet',       'Ewallet Report — Download',       'Download the Ewallet Report',       'Reports', 'Sales', 'export', 'medium', ARRAY['view_report_ewallet']),

  -- ── Payments (3 reports) ──────────────────────────────────────────────────
  ('view_report_payment_collection',     'Payment Collection Report — View',     'View the Payment Collection Report',     'Reports', 'Payments', 'view',   'low',    ARRAY['view_reports_payments']),
  ('download_report_payment_collection', 'Payment Collection Report — Download', 'Download the Payment Collection Report', 'Reports', 'Payments', 'export', 'medium', ARRAY['view_report_payment_collection']),
  ('view_report_pending_payment',        'Pending Payment Report — View',        'View the Pending Payment Report',        'Reports', 'Payments', 'view',   'low',    ARRAY['view_reports_payments']),
  ('download_report_pending_payment',    'Pending Payment Report — Download',    'Download the Pending Payment Report',    'Reports', 'Payments', 'export', 'medium', ARRAY['view_report_pending_payment']),
  ('view_report_cash_management',        'Cash Management Report — View',        'View the Cash Management Report',        'Reports', 'Payments', 'view',   'low',    ARRAY['view_reports_payments']),
  ('download_report_cash_management',    'Cash Management Report — Download',    'Download the Cash Management Report',    'Reports', 'Payments', 'export', 'medium', ARRAY['view_report_cash_management']),

  -- ── Clients (9 reports) ───────────────────────────────────────────────────
  ('view_report_all_clients',          'All Clients Report — View',          'View the All Clients Report',          'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_all_clients',      'All Clients Report — Download',      'Download the All Clients Report',      'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_all_clients']),
  ('view_report_client_revenue',       'Client Revenue Report — View',       'View the Client Revenue Report',       'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_client_revenue',   'Client Revenue Report — Download',   'Download the Client Revenue Report',   'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_client_revenue']),
  ('view_report_customer_frequency',   'Client Frequency Report — View',     'View the Client Frequency Report',     'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_customer_frequency', 'Client Frequency Report — Download', 'Download the Client Frequency Report', 'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_customer_frequency']),
  ('view_report_lost_customers',       'Lost Clients Report — View',         'View the Lost Clients Report',         'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_lost_customers',   'Lost Clients Report — Download',     'Download the Lost Clients Report',     'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_lost_customers']),
  ('view_report_customer_spend',       'VIP Clients Report — View',          'View the VIP Clients Report',          'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_customer_spend',   'VIP Clients Report — Download',      'Download the VIP Clients Report',      'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_customer_spend']),
  ('view_report_service_frequency',    'Service Frequency Report — View',    'View the Service Frequency Report',    'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_service_frequency', 'Service Frequency Report — Download', 'Download the Service Frequency Report', 'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_service_frequency']),
  ('view_report_referral_report',      'Referral Report — View',             'View the Referral Report',             'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_referral_report',  'Referral Report — Download',         'Download the Referral Report',         'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_referral_report']),
  ('view_report_client_rating',        'Client Rating Report — View',        'View the Client Rating Report (Clients)',       'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_client_rating',    'Client Rating Report — Download',    'Download the Client Rating Report (Clients)',   'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_client_rating']),
  ('view_report_enquiry_report',       'Enquiry Report — View',              'View the Enquiry Report',              'Reports', 'Clients', 'view',   'low',    ARRAY['view_reports_customers']),
  ('download_report_enquiry_report',   'Enquiry Report — Download',          'Download the Enquiry Report',          'Reports', 'Clients', 'export', 'medium', ARRAY['view_report_enquiry_report']),

  -- ── Appointments (3 reports) ──────────────────────────────────────────────
  ('view_report_appointment_detail',      'Detailed Appointment Reports — View',      'View the Detailed Appointment Reports',      'Reports', 'Appointments', 'view',   'low',    ARRAY['view_reports_appointments']),
  ('download_report_appointment_detail',  'Detailed Appointment Reports — Download',  'Download the Detailed Appointment Reports',  'Reports', 'Appointments', 'export', 'medium', ARRAY['view_report_appointment_detail']),
  ('view_report_upcoming_appointments',   'Upcoming Appointments Report — View',      'View the Upcoming Appointments Report',      'Reports', 'Appointments', 'view',   'low',    ARRAY['view_reports_appointments']),
  ('download_report_upcoming_appointments', 'Upcoming Appointments Report — Download', 'Download the Upcoming Appointments Report', 'Reports', 'Appointments', 'export', 'medium', ARRAY['view_report_upcoming_appointments']),
  ('view_report_no_show_recovery',        'No-Show Recovery Report — View',           'View the No-Show Recovery Report',           'Reports', 'Appointments', 'view',   'low',    ARRAY['view_reports_appointments']),
  ('download_report_no_show_recovery',    'No-Show Recovery Report — Download',       'Download the No-Show Recovery Report',       'Reports', 'Appointments', 'export', 'medium', ARRAY['view_report_no_show_recovery']),

  -- ── Inventory (10 reports) ────────────────────────────────────────────────
  ('view_report_product_sale_inventory',     'Product Retail Report — View',     'View the Product Retail Report (Inventory)',     'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_product_sale_inventory', 'Product Retail Report — Download', 'Download the Product Retail Report (Inventory)', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_product_sale_inventory']),
  ('view_report_product_margin_inventory',     'Product Margin Report — View',     'View the Product Margin Report (Inventory)',     'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_product_margin_inventory', 'Product Margin Report — Download', 'Download the Product Margin Report (Inventory)', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_product_margin_inventory']),
  ('view_report_product_inventory',       'Product Inventory Report — View',       'View the Product Inventory Report',       'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_product_inventory',   'Product Inventory Report — Download',   'Download the Product Inventory Report',   'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_product_inventory']),
  ('view_report_slow_moving_products',    'Slow Moving Products Report — View',    'View the Slow Moving Products Report',    'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_slow_moving_products', 'Slow Moving Products Report — Download', 'Download the Slow Moving Products Report', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_slow_moving_products']),
  ('view_report_fast_moving_products',    'Fast Moving Products Report — View',    'View the Fast Moving Products Report',    'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_fast_moving_products', 'Fast Moving Products Report — Download', 'Download the Fast Moving Products Report', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_fast_moving_products']),
  ('view_report_brand_performance',       'Brand Performance Report — View',       'View the Brand Performance Report',       'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_brand_performance',   'Brand Performance Report — Download',   'Download the Brand Performance Report',   'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_brand_performance']),
  ('view_report_purchase_vs_sales',       'Purchase vs Sales Inventory Report — View',   'View the Purchase vs Sales Inventory Report',   'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_purchase_vs_sales',   'Purchase vs Sales Inventory Report — Download', 'Download the Purchase vs Sales Inventory Report', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_purchase_vs_sales']),
  ('view_report_consumable_usage',        'Consumable Usage Report — View',        'View the Consumable Usage Report',        'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_consumable_usage',    'Consumable Usage Report — Download',    'Download the Consumable Usage Report',    'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_consumable_usage']),
  ('view_report_supplier_report',         'Supplier Report — View',                'View the Supplier Report',                'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_supplier_report',     'Supplier Report — Download',            'Download the Supplier Report',            'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_supplier_report']),
  ('view_report_purchase_history',        'Supplier Purchase History — View',      'View the Supplier Purchase History Report', 'Reports', 'Inventory', 'view',   'low',    ARRAY['view_reports_inventory']),
  ('download_report_purchase_history',    'Supplier Purchase History — Download',  'Download the Supplier Purchase History Report', 'Reports', 'Inventory', 'export', 'medium', ARRAY['view_report_purchase_history']),

  -- ── Staff (8 reports) ─────────────────────────────────────────────────────
  ('view_report_staff_sales',        'Staff Sales — View',        'View the Staff Sales Report',        'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_staff_sales',    'Staff Sales — Download',    'Download the Staff Sales Report',    'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_staff_sales']),
  ('view_report_staff_performance',  'Staff Performance — View',  'View the Staff Performance Report',  'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_staff_performance', 'Staff Performance — Download', 'Download the Staff Performance Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_staff_performance']),
  ('view_report_staff_item_sales',   'Service, Product, Membership & Package Sold by Staff — View', 'View items sold by staff', 'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_staff_item_sales', 'Service, Product, Membership & Package Sold by Staff — Download', 'Download items sold by staff', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_staff_item_sales']),
  ('view_report_commission_report',  'Commission Report — View',  'View the Commission Report',         'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_commission_report', 'Commission Report — Download', 'Download the Commission Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_commission_report']),
  ('view_report_tip_report',         'Tip Report — View',         'View the Tip Report',                'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_tip_report',     'Tip Report — Download',     'Download the Tip Report',            'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_tip_report']),
  ('view_report_attendance_report',  'Attendance Report — View',  'View the Attendance Report',         'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_attendance_report', 'Attendance Report — Download', 'Download the Attendance Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_attendance_report']),
  ('view_report_payroll_history',    'Payroll History Report — View', 'View the Payroll History Report', 'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_payroll_history', 'Payroll History Report — Download', 'Download the Payroll History Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_payroll_history']),
  ('view_report_rebooking_rate',     'Rebooking Rate Report — View', 'View the Rebooking Rate Report',   'Reports', 'Staff', 'view',   'low',    ARRAY['view_reports_staff']),
  ('download_report_rebooking_rate', 'Rebooking Rate Report — Download', 'Download the Rebooking Rate Report', 'Reports', 'Staff', 'export', 'medium', ARRAY['view_report_rebooking_rate']),

  -- ── Package & Membership (4 reports) ──────────────────────────────────────
  ('view_report_package_sale',        'Package Sale Report — View',        'View the Package Sale Report',        'Reports', 'Package & Membership', 'view',   'low',    ARRAY['view_reports_packages']),
  ('download_report_package_sale',    'Package Sale Report — Download',    'Download the Package Sale Report',    'Reports', 'Package & Membership', 'export', 'medium', ARRAY['view_report_package_sale']),
  ('view_report_package_history',     'Package History Report — View',     'View the Package History Report',     'Reports', 'Package & Membership', 'view',   'low',    ARRAY['view_reports_packages']),
  ('download_report_package_history', 'Package History Report — Download', 'Download the Package History Report', 'Reports', 'Package & Membership', 'export', 'medium', ARRAY['view_report_package_history']),
  ('view_report_member_sale',         'Membership Sale Report — View',     'View the Membership Sale Report',     'Reports', 'Package & Membership', 'view',   'low',    ARRAY['view_reports_packages']),
  ('download_report_member_sale',     'Membership Sale Report — Download', 'Download the Membership Sale Report', 'Reports', 'Package & Membership', 'export', 'medium', ARRAY['view_report_member_sale']),
  ('view_report_membership_history',  'Membership History Report — View',  'View the Membership History Report',  'Reports', 'Package & Membership', 'view',   'low',    ARRAY['view_reports_packages']),
  ('download_report_membership_history', 'Membership History Report — Download', 'Download the Membership History Report', 'Reports', 'Package & Membership', 'export', 'medium', ARRAY['view_report_membership_history']),

  -- ── Marketing (8 reports) ─────────────────────────────────────────────────
  ('view_report_wa_campaign',        'WA Marketing Campaign Report — View',    'View the WA Marketing Campaign Report',    'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_wa_campaign',    'WA Marketing Campaign Report — Download', 'Download the WA Marketing Campaign Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_wa_campaign']),
  ('view_report_mkt_feedback',       'Marketing Feedback & Ratings — View',    'View Marketing Feedback & Ratings',        'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_mkt_feedback',   'Marketing Feedback & Ratings — Download', 'Download Marketing Feedback & Ratings',   'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_mkt_feedback']),
  ('view_report_open_rate',          'Open Rate Report — View',                'View the Open Rate Report',                'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_open_rate',      'Open Rate Report — Download',            'Download the Open Rate Report',            'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_open_rate']),
  ('view_report_reply_rate',         'Reply Rate Report — View',               'View the Reply Rate Report',               'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_reply_rate',     'Reply Rate Report — Download',           'Download the Reply Rate Report',           'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_reply_rate']),
  ('view_report_birthday_campaign',  'Birthday Campaign Performance Report — View', 'View the Birthday Campaign Performance Report', 'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_birthday_campaign', 'Birthday Campaign Performance Report — Download', 'Download the Birthday Campaign Performance Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_birthday_campaign']),
  ('view_report_new_client_follow_up', 'New Client Follow-Up Report — View',   'View the New Client Follow-Up Report',     'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_new_client_follow_up', 'New Client Follow-Up Report — Download', 'Download the New Client Follow-Up Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_new_client_follow_up']),
  ('view_report_cancellation_recovery', 'Cancellation Recovery Report — View', 'View the Cancellation Recovery Report',    'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_cancellation_recovery', 'Cancellation Recovery Report — Download', 'Download the Cancellation Recovery Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_cancellation_recovery']),
  ('view_report_membership_opportunity', 'Membership Opportunity Report — View', 'View the Membership Opportunity Report', 'Reports', 'Marketing', 'view',   'low',    ARRAY['view_reports_marketing']),
  ('download_report_membership_opportunity', 'Membership Opportunity Report — Download', 'Download the Membership Opportunity Report', 'Reports', 'Marketing', 'export', 'medium', ARRAY['view_report_membership_opportunity'])
ON CONFLICT (key) DO NOTHING;

-- view_reports pre-dates this ticket (seeded with group_name IS NULL in
-- create_permissions_system_tables.sql) — without this fix it'd land in an
-- unintended "General" bucket alongside the 8 named category sections, the
-- same stray-bucket bug found and fixed for Staff/Catalog/Cash
-- Management/Marketing earlier this session. It stays real and load-bearing
-- (it's now the top-level "can enter the Reports section at all" umbrella —
-- see the view_reports VIRTUAL_PERMS entry in usePermissions.ts), so it
-- keeps its own "General" group rather than folding into one of the 8.
-- export_reports (confirmed dead, no route ever checked it) is removed
-- entirely by remove_export_reports_permission_key.sql — General ends up
-- with just this one key.
UPDATE permissions SET group_name = 'General' WHERE module = 'Reports' AND key = 'view_reports';

COMMIT;
