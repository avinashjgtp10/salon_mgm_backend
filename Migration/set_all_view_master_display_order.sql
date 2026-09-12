-- Extends the reveal-on-toggle + fixed display_order treatment (built for
-- Online Booking, then Catalog's 5 sections) to every remaining "View X"
-- master permission in the catalog that has real action children —
-- Calendar, Cash Management, Clients, Coupons, Dashboard, Enquiries,
-- Marketing (5 sub-sections), Quick Sale, Settings > Roles & Permissions,
-- Staff (5 sub-sections), and Warehouse (7 sub-sections). Same reasoning
-- as before: display_order was NULL on all of these, so rows sorted by the
-- hidden `action` column alphabetically instead of View-first-then-CRUD.
--
-- Reports is deliberately NOT included here — its View master
-- (view_reports) lives in a different subgroup ("General") than its 8
-- category children (each its own subgroup), and those categories in turn
-- have their own report children. Applying the same "hide until toggled"
-- rule there would make opening e.g. the "Sales" subgroup show a
-- completely empty list whenever view_reports is off, with no visible
-- master switch in that same screen to explain why — a materially
-- different, riskier case across 115 permissions that needs an explicit
-- decision, not a silent inclusion here.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

-- Calendar
UPDATE permissions SET display_order = 0 WHERE key = 'view_calendar';
UPDATE permissions SET display_order = 1 WHERE key = 'create_appointment';
UPDATE permissions SET display_order = 2 WHERE key = 'view_appointment';
UPDATE permissions SET display_order = 3 WHERE key = 'edit_appointment';
UPDATE permissions SET display_order = 4 WHERE key = 'delete_appointment';
UPDATE permissions SET display_order = 5 WHERE key = 'view_payment_details';
UPDATE permissions SET display_order = 6 WHERE key = 'cancel_appointment';

-- Cash Management
UPDATE permissions SET display_order = 0 WHERE key = 'view_cash_management';
UPDATE permissions SET display_order = 1 WHERE key = 'add_expense';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_expense';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_expense';
UPDATE permissions SET display_order = 4 WHERE key = 'close_counter';
UPDATE permissions SET display_order = 5 WHERE key = 'open_counter';
UPDATE permissions SET display_order = 6 WHERE key = 'export_cash_management_csv';
UPDATE permissions SET display_order = 7 WHERE key = 'export_cash_management_excel';
UPDATE permissions SET display_order = 8 WHERE key = 'export_cash_management_pdf';

-- Clients
UPDATE permissions SET display_order = 0 WHERE key = 'view_clients';
UPDATE permissions SET display_order = 1 WHERE key = 'create_clients';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_clients';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_clients';
UPDATE permissions SET display_order = 4 WHERE key = 'import_clients';
UPDATE permissions SET display_order = 5 WHERE key = 'view_client_history';
UPDATE permissions SET display_order = 6 WHERE key = 'view_referral_rewards';
UPDATE permissions SET display_order = 7 WHERE key = 'block_client';
UPDATE permissions SET display_order = 8 WHERE key = 'manage_client_purchase_history';
UPDATE permissions SET display_order = 9 WHERE key = 'export_clients';

-- Coupons
UPDATE permissions SET display_order = 0 WHERE key = 'view_coupons';
UPDATE permissions SET display_order = 1 WHERE key = 'manage_coupons';

-- Dashboard
UPDATE permissions SET display_order = 0 WHERE key = 'view_dashboard';
UPDATE permissions SET display_order = 1 WHERE key = 'view_dashboard_appointments';
UPDATE permissions SET display_order = 2 WHERE key = 'view_dashboard_client_info';
UPDATE permissions SET display_order = 3 WHERE key = 'view_dashboard_financials';
UPDATE permissions SET display_order = 4 WHERE key = 'view_dashboard_staff_performance';

-- Enquiries
UPDATE permissions SET display_order = 0 WHERE key = 'view_enquiries';
UPDATE permissions SET display_order = 1 WHERE key = 'add_enquiries';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_enquiries';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_enquiries';

-- Marketing :: Campaigns
UPDATE permissions SET display_order = 0 WHERE key = 'view_campaigns';
UPDATE permissions SET display_order = 1 WHERE key = 'create_campaigns';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_campaign';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_campaign';
UPDATE permissions SET display_order = 4 WHERE key = 'send_campaign';

-- Marketing :: Inbox
UPDATE permissions SET display_order = 0 WHERE key = 'view_inbox';
UPDATE permissions SET display_order = 1 WHERE key = 'reply_to_conversation';

-- Marketing :: Scheduled Templates
UPDATE permissions SET display_order = 0 WHERE key = 'view_scheduled_templates';
UPDATE permissions SET display_order = 1 WHERE key = 'create_scheduled_template';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_scheduled_template';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_scheduled_template';
UPDATE permissions SET display_order = 4 WHERE key = 'resend_scheduled_template';
UPDATE permissions SET display_order = 5 WHERE key = 'send_now_scheduled_template';

-- Marketing :: Templates
UPDATE permissions SET display_order = 0 WHERE key = 'view_templates';
UPDATE permissions SET display_order = 1 WHERE key = 'add_template';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_template';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_template';

-- Marketing :: WhatsApp Config
UPDATE permissions SET display_order = 0 WHERE key = 'view_whatsapp_config';
UPDATE permissions SET display_order = 1 WHERE key = 'edit_whatsapp_config';

-- Quick Sale
UPDATE permissions SET display_order = 0 WHERE key = 'view_sales';
UPDATE permissions SET display_order = 1 WHERE key = 'create_sales';
UPDATE permissions SET display_order = 2 WHERE key = 'import_sales';

-- Settings :: Roles & Permissions
UPDATE permissions SET display_order = 0 WHERE key = 'view_roles';
UPDATE permissions SET display_order = 1 WHERE key = 'manage_roles';

-- Staff :: Payroll
UPDATE permissions SET display_order = 0 WHERE key = 'view_payroll';
UPDATE permissions SET display_order = 1 WHERE key = 'add_salary_advance';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_payroll';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_payroll';
UPDATE permissions SET display_order = 4 WHERE key = 'view_payroll_details';
UPDATE permissions SET display_order = 5 WHERE key = 'pay_salary';
UPDATE permissions SET display_order = 6 WHERE key = 'export_payroll';

-- Staff :: Scheduled Shifts
UPDATE permissions SET display_order = 0 WHERE key = 'view_scheduled_shifts';
UPDATE permissions SET display_order = 1 WHERE key = 'add_time_off';
UPDATE permissions SET display_order = 2 WHERE key = 'add_working_hours';
UPDATE permissions SET display_order = 3 WHERE key = 'edit_working_hours';
UPDATE permissions SET display_order = 4 WHERE key = 'copy_schedule';
UPDATE permissions SET display_order = 5 WHERE key = 'manage_blocked_day';
UPDATE permissions SET display_order = 6 WHERE key = 'manage_day_off';

-- Staff :: Staff List
UPDATE permissions SET display_order = 0 WHERE key = 'view_team';
UPDATE permissions SET display_order = 1 WHERE key = 'add_team_member';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_team_member';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_staff';
UPDATE permissions SET display_order = 4 WHERE key = 'import_staff';
UPDATE permissions SET display_order = 5 WHERE key = 'deactivate_staff';
UPDATE permissions SET display_order = 6 WHERE key = 'manage_shifts';
UPDATE permissions SET display_order = 7 WHERE key = 'export_staff_csv';
UPDATE permissions SET display_order = 8 WHERE key = 'export_staff_excel';
UPDATE permissions SET display_order = 9 WHERE key = 'export_staff_pdf';

-- Staff :: Tip & Commission
UPDATE permissions SET display_order = 0 WHERE key = 'view_commissions';
UPDATE permissions SET display_order = 1 WHERE key = 'add_commission_rule';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_commission_rule';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_commission_rule';
UPDATE permissions SET display_order = 4 WHERE key = 'view_tips';
UPDATE permissions SET display_order = 5 WHERE key = 'add_tip';
UPDATE permissions SET display_order = 6 WHERE key = 'edit_tip';
UPDATE permissions SET display_order = 7 WHERE key = 'delete_tip';

-- Warehouse :: Consumable Inventory
UPDATE permissions SET display_order = 0 WHERE key = 'view_consumable_inventory';
UPDATE permissions SET display_order = 1 WHERE key = 'add_consumable';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_consumable';
UPDATE permissions SET display_order = 3 WHERE key = 'view_consumable_usage';
UPDATE permissions SET display_order = 4 WHERE key = 'activate_deactivate_consumable';
UPDATE permissions SET display_order = 5 WHERE key = 'adjust_consumable_stock';
UPDATE permissions SET display_order = 6 WHERE key = 'download_consumable_inventory_csv';
UPDATE permissions SET display_order = 7 WHERE key = 'download_consumable_inventory_excel';
UPDATE permissions SET display_order = 8 WHERE key = 'download_consumable_inventory_pdf';

-- Warehouse :: Orders
UPDATE permissions SET display_order = 0 WHERE key = 'view_orders';
UPDATE permissions SET display_order = 1 WHERE key = 'create_order';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_order';
UPDATE permissions SET display_order = 3 WHERE key = 'cancel_order';
UPDATE permissions SET display_order = 4 WHERE key = 'receive_order';
UPDATE permissions SET display_order = 5 WHERE key = 'download_order_pdf';

-- Warehouse :: Product Audit
UPDATE permissions SET display_order = 0 WHERE key = 'view_product_audit';
UPDATE permissions SET display_order = 1 WHERE key = 'create_product_audit';
UPDATE permissions SET display_order = 2 WHERE key = 'approve_product_audit';
UPDATE permissions SET display_order = 3 WHERE key = 'export_product_audit_excel';

-- Warehouse :: Product Inventory
UPDATE permissions SET display_order = 0 WHERE key = 'view_product_inventory';
UPDATE permissions SET display_order = 1 WHERE key = 'add_product';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_product';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_product';
UPDATE permissions SET display_order = 4 WHERE key = 'view_product_stock_history';
UPDATE permissions SET display_order = 5 WHERE key = 'adjust_product_stock';
UPDATE permissions SET display_order = 6 WHERE key = 'download_product_inventory_csv';
UPDATE permissions SET display_order = 7 WHERE key = 'download_product_inventory_excel';
UPDATE permissions SET display_order = 8 WHERE key = 'download_product_inventory_pdf';

-- Warehouse :: Stock Ledger (2 independent masters: view_inventory,
-- view_stock_ledger — same shape as Packages' 3-cluster grouping)
UPDATE permissions SET display_order = 0 WHERE key = 'view_inventory';
UPDATE permissions SET display_order = 1 WHERE key = 'manage_inventory';
UPDATE permissions SET display_order = 2 WHERE key = 'stock_adjustment';
UPDATE permissions SET display_order = 3 WHERE key = 'view_stock_ledger';
UPDATE permissions SET display_order = 4 WHERE key = 'edit_stock_ledger';
UPDATE permissions SET display_order = 5 WHERE key = 'delete_stock_ledger';
UPDATE permissions SET display_order = 6 WHERE key = 'stock_ledger_adjustment';
UPDATE permissions SET display_order = 7 WHERE key = 'export_stock_ledger_excel';

-- Warehouse :: Suppliers
UPDATE permissions SET display_order = 0 WHERE key = 'view_suppliers';
UPDATE permissions SET display_order = 1 WHERE key = 'create_suppliers';
UPDATE permissions SET display_order = 2 WHERE key = 'edit_suppliers';
UPDATE permissions SET display_order = 3 WHERE key = 'delete_suppliers';
UPDATE permissions SET display_order = 4 WHERE key = 'supplier_payout';

COMMIT;
