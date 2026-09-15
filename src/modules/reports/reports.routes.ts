import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { subscriptionMiddleware } from "../../middleware/subscription.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { reportsController } from "./reports.controller";

// ======================================================
// SALES SUMMARY REPORT (independent report API)
// Reads sales/sale_items/payments directly — never calls the Appointment
// API/service. Mounted at /api/report (not /api/v1) in app.ts.
// ======================================================

const router = Router();

// baseGuard covers auth/subscription/role only — the individual-report
// permission check (view_report_<id>, matching REPORTS[].id in
// ReportsPage.tsx) is appended per-route below, replacing the old single
// shared view_reports check that covered every report identically.
const baseGuard = [
    authMiddleware,
    subscriptionMiddleware,
    roleMiddleware("salon_owner", "admin", "staff", "super_admin"),
];
const viewReport = (key: string) => requirePermission(key);

router.post(
    "/sales-summary",
    ...baseGuard, viewReport("view_report_sales_summary"),
    reportsController.getSalesSummaryReport
);

router.get(
    "/sales-summary/:saleId",
    ...baseGuard, viewReport("view_report_sales_summary"),
    reportsController.getSaleDetail
);

// ======================================================
// DAILY SHEET REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/daily-sheet",
    ...baseGuard, viewReport("view_report_daily_sheet"),
    reportsController.getDailySheetReport
);

// ======================================================
// PRODUCT RETAIL REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// Shows under BOTH the Sales and Inventory report categories in
// ReportsPage.tsx (REPORTS ids "product_sale" and "product_sale_inventory"
// — same component, same backend endpoint) — per explicit instruction these
// get independent toggles, so either one alone is enough to reach this route.
// ======================================================

router.post(
    "/product-retail",
    ...baseGuard, requireAnyPermission(["view_report_product_sale", "view_report_product_sale_inventory"]),
    reportsController.getProductRetailReport
);

// ======================================================
// SERVICE SALE REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/service-sale",
    ...baseGuard, viewReport("view_report_service_sale"),
    reportsController.getServiceSaleReport
);

// ======================================================
// GST / TAXES REPORT (independent report API)
// Reads sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/gst",
    ...baseGuard, viewReport("view_report_taxes"),
    reportsController.getGstReport
);

// ======================================================
// PRODUCT INVENTORY SALES (independent report API)
// Reads sale_items/sales directly — never calls the Appointment API/service.
// Powers the "Sales" column on the Product Inventory report.
// ======================================================

router.post(
    "/product-inventory-sales",
    ...baseGuard, viewReport("view_report_product_inventory"),
    reportsController.getProductInventorySales
);

// ======================================================
// PRODUCT INVENTORY REPORT (independent report API)
// Reads products directly (brand/category joined by name) — never calls the
// Appointment API/service.
// ======================================================

router.post(
    "/product-inventory",
    ...baseGuard, viewReport("view_report_product_inventory"),
    reportsController.getProductInventoryReport
);

// ======================================================
// SLOW MOVING / FAST MOVING PRODUCTS REPORTS (independent report APIs)
// Reads products directly (sales aggregated from sale_items/sales within
// the selected date range) — never calls the Appointment API/service.
// ======================================================

router.post(
    "/slow-moving-products",
    ...baseGuard, viewReport("view_report_slow_moving_products"),
    reportsController.getSlowMovingProductsReport
);

router.post(
    "/fast-moving-products",
    ...baseGuard, viewReport("view_report_fast_moving_products"),
    reportsController.getFastMovingProductsReport
);

// ======================================================
// BRAND PERFORMANCE REPORT (independent report API)
// Reads products/product_brands directly (sales aggregated from sale_items/
// sales) — never calls the Appointment API/service.
// ======================================================

router.post(
    "/brand-performance",
    ...baseGuard, viewReport("view_report_brand_performance"),
    reportsController.getBrandPerformanceReport
);

// ======================================================
// PURCHASE VS SALES INVENTORY REPORT (independent report API)
// Reads products/stock_movements/consumable_usage/sale_items directly —
// never calls the Appointment API/service.
// ======================================================

router.post(
    "/purchase-vs-sales",
    ...baseGuard, viewReport("view_report_purchase_vs_sales"),
    reportsController.getPurchaseVsSalesReport
);

// ======================================================
// PRODUCT MARGIN REPORT (independent report API)
// Reads sale_items/products directly — never calls the Appointment
// API/service. Shows under BOTH Sales and Inventory categories (REPORTS ids
// "product_margin" and "product_margin_inventory") — independent toggles,
// same treatment as Product Retail above.
// ======================================================

router.post(
    "/product-margin",
    ...baseGuard, requireAnyPermission(["view_report_product_margin", "view_report_product_margin_inventory"]),
    reportsController.getProductMarginReport
);

// ======================================================
// REWARD POINTS REPORT (independent report API)
// Reads clients/reward_points_ledger directly — never calls the Appointment
// API/service.
// ======================================================

router.post(
    "/reward-points",
    ...baseGuard, viewReport("view_report_reward"),
    reportsController.getRewardPointsReport
);

// ======================================================
// E-WALLET REPORT (independent report API)
// Reads clients directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/ewallet",
    ...baseGuard, viewReport("view_report_ewallet"),
    reportsController.getEwalletReport
);

// ======================================================
// CLIENT REVENUE REPORT (independent report API)
// Reads sales/clients directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/client-revenue",
    ...baseGuard, viewReport("view_report_client_revenue"),
    reportsController.getClientRevenueReport
);

// ======================================================
// ALL CLIENTS REPORT (independent report API)
// Reads clients directly — never calls the Appointment API/service. Pure
// client-profile listing, no revenue/visit figures.
// ======================================================

router.post(
    "/all-clients",
    ...baseGuard, viewReport("view_report_all_clients"),
    reportsController.getAllClientsReport
);

// ======================================================
// NEW CLIENT FOLLOW-UP REPORT (independent report API)
// "New" clients (joined within the last N days) who have never had a
// completed/paid appointment yet — same "new" convention as All Clients'
// customer_type filter, scoped to a shorter trailing window.
// ======================================================

router.post(
    "/new-client-follow-up",
    ...baseGuard, viewReport("view_report_new_client_follow_up"),
    reportsController.getNewClientFollowUpReport
);

// ======================================================
// CANCELLATION RECOVERY REPORT (independent report API)
// Clients whose most recent appointment was a cancellation within the
// trailing window, with no rebooking since.
// ======================================================

router.post(
    "/cancellation-recovery",
    ...baseGuard, viewReport("view_report_cancellation_recovery"),
    reportsController.getCancellationRecoveryReport
);

// ======================================================
// MEMBERSHIP OPPORTUNITY REPORT (independent report API)
// Frequent visitors with no currently active membership.
// ======================================================

router.post(
    "/membership-opportunity",
    ...baseGuard, viewReport("view_report_membership_opportunity"),
    reportsController.getMembershipOpportunityReport
);

// ======================================================
// NO-SHOW RECOVERY REPORT (independent report API)
// No-show appointments within the filtered window, meant to be paired with
// a WhatsApp recovery template.
// ======================================================

router.post(
    "/no-show-recovery",
    ...baseGuard, viewReport("view_report_no_show_recovery"),
    reportsController.getNoShowRecoveryReport
);

// ======================================================
// ENQUIRY REPORT (independent report API)
// Reads the enquiries table directly — same data the Add Enquiry form and
// EnquiriesListPage already create/manage, with richer filters and KPIs.
// ======================================================

router.post(
    "/enquiries",
    ...baseGuard, viewReport("view_report_enquiry_report"),
    reportsController.getEnquiryReport
);

// ======================================================
// CUSTOMER FREQUENCY REPORT (independent report API)
// Reads clients/sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/customer-frequency",
    ...baseGuard, viewReport("view_report_customer_frequency"),
    reportsController.getCustomerFrequencyReport
);

// ======================================================
// LOST CUSTOMERS REPORT (independent report API)
// Standalone report — separate from Customer Frequency's fixed 90-day
// "lost" bucket, with a user-configurable lost_days cutoff.
// ======================================================

router.post(
    "/lost-customers",
    ...baseGuard, viewReport("view_report_lost_customers"),
    reportsController.getLostCustomersReport
);

// ======================================================
// CUSTOMER SPEND SEGMENTS REPORT (independent report API)
// Classifies clients VIP / Regular / Low against owner-set ₹ thresholds.
// Reads clients/sales directly, never the Appointment API.
// ======================================================

router.post(
    "/customer-spend",
    ...baseGuard, viewReport("view_report_customer_spend"),
    reportsController.getCustomerSpendReport
);

// ======================================================
// SERVICE FREQUENCY REPORT (independent report API)
// One row per client + service pair — how often each client returns for a
// given service. Reads sale_items/sales/clients directly, never the
// Appointment API.
// ======================================================

router.post(
    "/service-frequency",
    ...baseGuard, viewReport("view_report_service_frequency"),
    reportsController.getServiceFrequencyReport
);

// ======================================================
// MEMBERSHIP HISTORY REPORT (independent report API)
// One row per membership benefit redemption, read from
// membership_usage_log — the membership counterpart to Package History.
// ======================================================

router.post(
    "/membership-history",
    ...baseGuard, viewReport("view_report_membership_history"),
    reportsController.getMembershipHistoryReport
);

// ======================================================
// PAYMENT COLLECTION REPORT (independent report API)
// Reads appointments + payments directly (never sales — an unpaid bill has
// no sales row at all). Due is read from the latest payment row per
// appointment, never summed.
// ======================================================

router.post(
    "/payment-collection",
    ...baseGuard, viewReport("view_report_payment_collection"),
    reportsController.getPaymentCollectionReport
);

// ======================================================
// PENDING PAYMENT REPORT (independent report API)
// Reads appointments + payments directly (never sales — an unpaid bill has
// no sales row at all). Shares Payment Collection's underlying aggregation,
// scoped to due_amount > 0.
// ======================================================

router.post(
    "/pending-payment",
    ...baseGuard, viewReport("view_report_pending_payment"),
    reportsController.getPendingPaymentReport
);

// ======================================================
// CASH MANAGEMENT REPORT (independent report API)
// Reads cash_management directly — never calls the cash-management module's
// own service/repository, and never calls the Appointment API/service.
// ======================================================

router.post(
    "/cash-management",
    ...baseGuard, viewReport("view_report_cash_management"),
    reportsController.getCashManagementReport
);

// ======================================================
// REFERRAL REPORT (independent report API)
// One row per referred client, joined back to the referrer. Reads
// clients/sales/referral_ledger directly — never calls the Appointment API.
// ======================================================

router.post(
    "/referral",
    ...baseGuard, viewReport("view_report_referral_report"),
    reportsController.getReferralReport
);

// ======================================================
// CLIENT RATING REPORT (independent report API)
// Reads the reviews table directly — never calls into the reviews module's
// service/repository, and never calls the Appointment API/service. Shows
// under BOTH Clients ("Client Rating Report") and Marketing ("Marketing
// Feedback & Ratings") categories (REPORTS ids "client_rating" and
// "mkt_feedback") — independent toggles, same treatment as Product
// Retail/Margin above.
// ======================================================

router.post(
    "/client-rating",
    ...baseGuard, requireAnyPermission(["view_report_client_rating", "view_report_mkt_feedback"]),
    reportsController.getClientRatingReport
);

// ======================================================
// STAFF SALES REPORT (independent report API)
// Reads sale_items/sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-sales",
    ...baseGuard, viewReport("view_report_staff_sales"),
    reportsController.getStaffSalesReport
);

// ======================================================
// STAFF PERFORMANCE REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-performance",
    ...baseGuard, viewReport("view_report_staff_performance"),
    reportsController.getStaffPerformanceReport
);

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// Reads sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-item-sales",
    ...baseGuard, viewReport("view_report_staff_item_sales"),
    reportsController.getStaffItemSalesReport
);

// ======================================================
// REBOOKING RATE REPORT (independent report API)
// Reads sales/sale_items/clients directly — never calls the Appointment
// API/service. Per staff, what share of their served visits led to the
// client returning within a user-entered day window.
// ======================================================

router.post(
    "/rebooking-rate",
    ...baseGuard, viewReport("view_report_rebooking_rate"),
    reportsController.getRebookingRateReport
);

// ======================================================
// PAYROLL HISTORY REPORT (independent report API)
// Reads payroll_entries directly — never calls the Appointment API.
// ======================================================

router.post(
    "/payroll-history",
    ...baseGuard, viewReport("view_report_payroll_history"),
    reportsController.getPayrollHistoryReport
);

// ======================================================
// PACKAGE SALE REPORT (independent report API)
// Reads client_packages directly — never calls the Appointment API.
// ======================================================

router.post(
    "/package-sale",
    ...baseGuard, viewReport("view_report_package_sale"),
    reportsController.getPackageSaleReport
);

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// Reads client_package_session_history directly — never calls the
// Appointment API.
// ======================================================

router.post(
    "/package-history",
    ...baseGuard, viewReport("view_report_package_history"),
    reportsController.getPackageHistoryReport
);

// ======================================================
// MEMBER SALE REPORT (independent report API)
// Reads client_memberships directly — never calls the Appointment API.
// ======================================================

router.post(
    "/member-sale",
    ...baseGuard, viewReport("view_report_member_sale"),
    reportsController.getMemberSaleReport
);

// ======================================================
// APPOINTMENT DETAIL REPORT (independent report API)
// Reads the appointments table directly via SQL — never calls the
// Appointment HTTP API/service.
// ======================================================

router.post(
    "/appointment-detail",
    ...baseGuard, viewReport("view_report_appointment_detail"),
    reportsController.getAppointmentDetailReport
);

// ======================================================
// UPCOMING APPOINTMENTS REPORT (independent report API)
// Reads the appointments table directly via SQL — never calls the
// Appointment HTTP API/service. Scoped to future, still-booked appointments.
// ======================================================

router.post(
    "/upcoming-appointments",
    ...baseGuard, viewReport("view_report_upcoming_appointments"),
    reportsController.getUpcomingAppointmentsReport
);

// ======================================================
// WA MARKETING CAMPAIGN REPORT (independent report API)
// Reads wa_campaigns directly — never calls the campaigns HTTP API/service.
// ======================================================

router.post(
    "/wa-campaign",
    ...baseGuard, viewReport("view_report_wa_campaign"),
    reportsController.getWaCampaignReport
);

// ======================================================
// OPEN RATE REPORT (independent report API)
// Same data source as /wa-campaign above, different question: engagement
// (opened ÷ delivered) rather than delivery throughput.
// ======================================================

router.post(
    "/open-rate",
    ...baseGuard, viewReport("view_report_open_rate"),
    reportsController.getOpenRateReport
);

router.post(
    "/open-rate/campaign",
    ...baseGuard, viewReport("view_report_open_rate"),
    reportsController.getOpenRateCampaignDetail
);

// ======================================================
// BIRTHDAY CAMPAIGN PERFORMANCE REPORT (independent report API)
// Reads wa_automation_logs directly (event_type = 'birthday_wishes'), never
// through the whatsapp-automation module's own API.
// ======================================================

router.post(
    "/birthday-campaign",
    ...baseGuard, viewReport("view_report_birthday_campaign"),
    reportsController.getBirthdayCampaignReport
);

// ======================================================
// REPLY RATE REPORT (independent report API)
// Replies are attributed by phone + a 24h window — see WA_REPLY_WINDOW in
// reports.repository.ts, since nothing links a message to a campaign.
// ======================================================

router.post(
    "/reply-rate",
    ...baseGuard, viewReport("view_report_reply_rate"),
    reportsController.getReplyRateReport
);

router.post(
    "/reply-rate/campaign",
    ...baseGuard, viewReport("view_report_reply_rate"),
    reportsController.getReplyRateCampaignDetail
);

export default router;
