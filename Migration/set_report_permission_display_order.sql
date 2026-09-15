-- Sets display_order for all 114 Reports permission keys added in
-- add_individual_report_permission_keys.sql. That migration's INSERT
-- listed everything in the ticket's exact sequence, but never set
-- display_order — roles.repository.ts's listPermissions query sorts by
-- `module, group_name NULLS FIRST, display_order NULLS LAST, action`, so
-- with every row's display_order NULL they fell back to alphabetical-by-
-- action order (all the *views* together, then all the *downloads*
-- together, reports themselves alphabetical) instead of the intended
-- "View, Download" pair per report, reports in ticket order.
--
-- display_order restarts at 0 within each group_name (the ORDER BY already
-- sorts by group_name first, so values only need to be unique per group,
-- not globally). Each category's parent permission (view_reports_<key>)
-- gets 0, so it always sorts first — matching the pattern already visible
-- in the General group, where View Reports leads. Each report then gets
-- two consecutive values (View, Download) in the ticket's listed order.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order — after
-- add_individual_report_permission_keys.sql, since this only updates rows
-- that migration creates.

BEGIN;

-- Category parents
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_sales';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_payments';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_customers';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_appointments';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_inventory';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_staff';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_packages';
UPDATE permissions SET display_order = 0 WHERE key = 'view_reports_marketing';

-- Sales (8 reports)
UPDATE permissions SET display_order = 1  WHERE key = 'view_report_sales_summary';
UPDATE permissions SET display_order = 2  WHERE key = 'download_report_sales_summary';
UPDATE permissions SET display_order = 3  WHERE key = 'view_report_daily_sheet';
UPDATE permissions SET display_order = 4  WHERE key = 'download_report_daily_sheet';
UPDATE permissions SET display_order = 5  WHERE key = 'view_report_product_sale';
UPDATE permissions SET display_order = 6  WHERE key = 'download_report_product_sale';
UPDATE permissions SET display_order = 7  WHERE key = 'view_report_service_sale';
UPDATE permissions SET display_order = 8  WHERE key = 'download_report_service_sale';
UPDATE permissions SET display_order = 9  WHERE key = 'view_report_taxes';
UPDATE permissions SET display_order = 10 WHERE key = 'download_report_taxes';
UPDATE permissions SET display_order = 11 WHERE key = 'view_report_product_margin';
UPDATE permissions SET display_order = 12 WHERE key = 'download_report_product_margin';
UPDATE permissions SET display_order = 13 WHERE key = 'view_report_reward';
UPDATE permissions SET display_order = 14 WHERE key = 'download_report_reward';
UPDATE permissions SET display_order = 15 WHERE key = 'view_report_ewallet';
UPDATE permissions SET display_order = 16 WHERE key = 'download_report_ewallet';

-- Payments (3 reports)
UPDATE permissions SET display_order = 1 WHERE key = 'view_report_payment_collection';
UPDATE permissions SET display_order = 2 WHERE key = 'download_report_payment_collection';
UPDATE permissions SET display_order = 3 WHERE key = 'view_report_pending_payment';
UPDATE permissions SET display_order = 4 WHERE key = 'download_report_pending_payment';
UPDATE permissions SET display_order = 5 WHERE key = 'view_report_cash_management';
UPDATE permissions SET display_order = 6 WHERE key = 'download_report_cash_management';

-- Clients (9 reports)
UPDATE permissions SET display_order = 1  WHERE key = 'view_report_all_clients';
UPDATE permissions SET display_order = 2  WHERE key = 'download_report_all_clients';
UPDATE permissions SET display_order = 3  WHERE key = 'view_report_client_revenue';
UPDATE permissions SET display_order = 4  WHERE key = 'download_report_client_revenue';
UPDATE permissions SET display_order = 5  WHERE key = 'view_report_customer_frequency';
UPDATE permissions SET display_order = 6  WHERE key = 'download_report_customer_frequency';
UPDATE permissions SET display_order = 7  WHERE key = 'view_report_lost_customers';
UPDATE permissions SET display_order = 8  WHERE key = 'download_report_lost_customers';
UPDATE permissions SET display_order = 9  WHERE key = 'view_report_customer_spend';
UPDATE permissions SET display_order = 10 WHERE key = 'download_report_customer_spend';
UPDATE permissions SET display_order = 11 WHERE key = 'view_report_service_frequency';
UPDATE permissions SET display_order = 12 WHERE key = 'download_report_service_frequency';
UPDATE permissions SET display_order = 13 WHERE key = 'view_report_referral_report';
UPDATE permissions SET display_order = 14 WHERE key = 'download_report_referral_report';
UPDATE permissions SET display_order = 15 WHERE key = 'view_report_client_rating';
UPDATE permissions SET display_order = 16 WHERE key = 'download_report_client_rating';
UPDATE permissions SET display_order = 17 WHERE key = 'view_report_enquiry_report';
UPDATE permissions SET display_order = 18 WHERE key = 'download_report_enquiry_report';

-- Appointments (3 reports)
UPDATE permissions SET display_order = 1 WHERE key = 'view_report_appointment_detail';
UPDATE permissions SET display_order = 2 WHERE key = 'download_report_appointment_detail';
UPDATE permissions SET display_order = 3 WHERE key = 'view_report_upcoming_appointments';
UPDATE permissions SET display_order = 4 WHERE key = 'download_report_upcoming_appointments';
UPDATE permissions SET display_order = 5 WHERE key = 'view_report_no_show_recovery';
UPDATE permissions SET display_order = 6 WHERE key = 'download_report_no_show_recovery';

-- Inventory (10 reports)
UPDATE permissions SET display_order = 1  WHERE key = 'view_report_product_sale_inventory';
UPDATE permissions SET display_order = 2  WHERE key = 'download_report_product_sale_inventory';
UPDATE permissions SET display_order = 3  WHERE key = 'view_report_product_margin_inventory';
UPDATE permissions SET display_order = 4  WHERE key = 'download_report_product_margin_inventory';
UPDATE permissions SET display_order = 5  WHERE key = 'view_report_product_inventory';
UPDATE permissions SET display_order = 6  WHERE key = 'download_report_product_inventory';
UPDATE permissions SET display_order = 7  WHERE key = 'view_report_slow_moving_products';
UPDATE permissions SET display_order = 8  WHERE key = 'download_report_slow_moving_products';
UPDATE permissions SET display_order = 9  WHERE key = 'view_report_fast_moving_products';
UPDATE permissions SET display_order = 10 WHERE key = 'download_report_fast_moving_products';
UPDATE permissions SET display_order = 11 WHERE key = 'view_report_brand_performance';
UPDATE permissions SET display_order = 12 WHERE key = 'download_report_brand_performance';
UPDATE permissions SET display_order = 13 WHERE key = 'view_report_purchase_vs_sales';
UPDATE permissions SET display_order = 14 WHERE key = 'download_report_purchase_vs_sales';
UPDATE permissions SET display_order = 15 WHERE key = 'view_report_consumable_usage';
UPDATE permissions SET display_order = 16 WHERE key = 'download_report_consumable_usage';
UPDATE permissions SET display_order = 17 WHERE key = 'view_report_supplier_report';
UPDATE permissions SET display_order = 18 WHERE key = 'download_report_supplier_report';
UPDATE permissions SET display_order = 19 WHERE key = 'view_report_purchase_history';
UPDATE permissions SET display_order = 20 WHERE key = 'download_report_purchase_history';

-- Staff (8 reports)
UPDATE permissions SET display_order = 1  WHERE key = 'view_report_staff_sales';
UPDATE permissions SET display_order = 2  WHERE key = 'download_report_staff_sales';
UPDATE permissions SET display_order = 3  WHERE key = 'view_report_staff_performance';
UPDATE permissions SET display_order = 4  WHERE key = 'download_report_staff_performance';
UPDATE permissions SET display_order = 5  WHERE key = 'view_report_staff_item_sales';
UPDATE permissions SET display_order = 6  WHERE key = 'download_report_staff_item_sales';
UPDATE permissions SET display_order = 7  WHERE key = 'view_report_commission_report';
UPDATE permissions SET display_order = 8  WHERE key = 'download_report_commission_report';
UPDATE permissions SET display_order = 9  WHERE key = 'view_report_tip_report';
UPDATE permissions SET display_order = 10 WHERE key = 'download_report_tip_report';
UPDATE permissions SET display_order = 11 WHERE key = 'view_report_attendance_report';
UPDATE permissions SET display_order = 12 WHERE key = 'download_report_attendance_report';
UPDATE permissions SET display_order = 13 WHERE key = 'view_report_payroll_history';
UPDATE permissions SET display_order = 14 WHERE key = 'download_report_payroll_history';
UPDATE permissions SET display_order = 15 WHERE key = 'view_report_rebooking_rate';
UPDATE permissions SET display_order = 16 WHERE key = 'download_report_rebooking_rate';

-- Package & Membership (4 reports)
UPDATE permissions SET display_order = 1 WHERE key = 'view_report_package_sale';
UPDATE permissions SET display_order = 2 WHERE key = 'download_report_package_sale';
UPDATE permissions SET display_order = 3 WHERE key = 'view_report_package_history';
UPDATE permissions SET display_order = 4 WHERE key = 'download_report_package_history';
UPDATE permissions SET display_order = 5 WHERE key = 'view_report_member_sale';
UPDATE permissions SET display_order = 6 WHERE key = 'download_report_member_sale';
UPDATE permissions SET display_order = 7 WHERE key = 'view_report_membership_history';
UPDATE permissions SET display_order = 8 WHERE key = 'download_report_membership_history';

-- Marketing (8 reports)
UPDATE permissions SET display_order = 1  WHERE key = 'view_report_wa_campaign';
UPDATE permissions SET display_order = 2  WHERE key = 'download_report_wa_campaign';
UPDATE permissions SET display_order = 3  WHERE key = 'view_report_mkt_feedback';
UPDATE permissions SET display_order = 4  WHERE key = 'download_report_mkt_feedback';
UPDATE permissions SET display_order = 5  WHERE key = 'view_report_open_rate';
UPDATE permissions SET display_order = 6  WHERE key = 'download_report_open_rate';
UPDATE permissions SET display_order = 7  WHERE key = 'view_report_reply_rate';
UPDATE permissions SET display_order = 8  WHERE key = 'download_report_reply_rate';
UPDATE permissions SET display_order = 9  WHERE key = 'view_report_birthday_campaign';
UPDATE permissions SET display_order = 10 WHERE key = 'download_report_birthday_campaign';
UPDATE permissions SET display_order = 11 WHERE key = 'view_report_new_client_follow_up';
UPDATE permissions SET display_order = 12 WHERE key = 'download_report_new_client_follow_up';
UPDATE permissions SET display_order = 13 WHERE key = 'view_report_cancellation_recovery';
UPDATE permissions SET display_order = 14 WHERE key = 'download_report_cancellation_recovery';
UPDATE permissions SET display_order = 15 WHERE key = 'view_report_membership_opportunity';
UPDATE permissions SET display_order = 16 WHERE key = 'download_report_membership_opportunity';

COMMIT;
