import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { subscriptionMiddleware } from "../../middleware/subscription.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { reportsController } from "./reports.controller";

// ======================================================
// SALES SUMMARY REPORT (independent report API)
// Reads sales/sale_items/payments directly — never calls the Appointment
// API/service. Mounted at /api/report (not /api/v1) in app.ts.
// ======================================================

const router = Router();

const guard = [
    authMiddleware,
    subscriptionMiddleware,
    roleMiddleware("salon_owner", "admin", "staff", "super_admin"),
    requirePermission("view_reports"),
];

router.post(
    "/sales-summary",
    ...guard,
    reportsController.getSalesSummaryReport
);

router.get(
    "/sales-summary/:saleId",
    ...guard,
    reportsController.getSaleDetail
);

// ======================================================
// DAILY SHEET REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/daily-sheet",
    ...guard,
    reportsController.getDailySheetReport
);

// ======================================================
// PRODUCT RETAIL REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/product-retail",
    ...guard,
    reportsController.getProductRetailReport
);

// ======================================================
// SERVICE SALE REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/service-sale",
    ...guard,
    reportsController.getServiceSaleReport
);

// ======================================================
// GST / TAXES REPORT (independent report API)
// Reads sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/gst",
    ...guard,
    reportsController.getGstReport
);

// ======================================================
// PRODUCT INVENTORY SALES (independent report API)
// Reads sale_items/sales directly — never calls the Appointment API/service.
// Powers the "Sales" column on the Product Inventory report.
// ======================================================

router.post(
    "/product-inventory-sales",
    ...guard,
    reportsController.getProductInventorySales
);

// ======================================================
// PRODUCT INVENTORY REPORT (independent report API)
// Reads products directly (brand/category joined by name) — never calls the
// Appointment API/service.
// ======================================================

router.post(
    "/product-inventory",
    ...guard,
    reportsController.getProductInventoryReport
);

// ======================================================
// SLOW MOVING / FAST MOVING PRODUCTS REPORTS (independent report APIs)
// Reads products directly (sales aggregated from sale_items/sales within
// the selected date range) — never calls the Appointment API/service.
// ======================================================

router.post(
    "/slow-moving-products",
    ...guard,
    reportsController.getSlowMovingProductsReport
);

router.post(
    "/fast-moving-products",
    ...guard,
    reportsController.getFastMovingProductsReport
);

// ======================================================
// BRAND PERFORMANCE REPORT (independent report API)
// Reads products/product_brands directly (sales aggregated from sale_items/
// sales) — never calls the Appointment API/service.
// ======================================================

router.post(
    "/brand-performance",
    ...guard,
    reportsController.getBrandPerformanceReport
);

// ======================================================
// PURCHASE VS SALES INVENTORY REPORT (independent report API)
// Reads products/stock_movements/consumable_usage/sale_items directly —
// never calls the Appointment API/service.
// ======================================================

router.post(
    "/purchase-vs-sales",
    ...guard,
    reportsController.getPurchaseVsSalesReport
);

// ======================================================
// PRODUCT MARGIN REPORT (independent report API)
// Reads sale_items/products directly — never calls the Appointment
// API/service.
// ======================================================

router.post(
    "/product-margin",
    ...guard,
    reportsController.getProductMarginReport
);

// ======================================================
// REWARD POINTS REPORT (independent report API)
// Reads clients/reward_points_ledger directly — never calls the Appointment
// API/service.
// ======================================================

router.post(
    "/reward-points",
    ...guard,
    reportsController.getRewardPointsReport
);

// ======================================================
// E-WALLET REPORT (independent report API)
// Reads clients directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/ewallet",
    ...guard,
    reportsController.getEwalletReport
);

// ======================================================
// CLIENT REVENUE REPORT (independent report API)
// Reads sales/clients directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/client-revenue",
    ...guard,
    reportsController.getClientRevenueReport
);

// ======================================================
// ALL CLIENTS REPORT (independent report API)
// Reads clients directly — never calls the Appointment API/service. Pure
// client-profile listing, no revenue/visit figures.
// ======================================================

router.post(
    "/all-clients",
    ...guard,
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
    ...guard,
    reportsController.getNewClientFollowUpReport
);

// ======================================================
// CANCELLATION RECOVERY REPORT (independent report API)
// Clients whose most recent appointment was a cancellation within the
// trailing window, with no rebooking since.
// ======================================================

router.post(
    "/cancellation-recovery",
    ...guard,
    reportsController.getCancellationRecoveryReport
);

// ======================================================
// MEMBERSHIP OPPORTUNITY REPORT (independent report API)
// Frequent visitors with no currently active membership.
// ======================================================

router.post(
    "/membership-opportunity",
    ...guard,
    reportsController.getMembershipOpportunityReport
);

// ======================================================
// NO-SHOW RECOVERY REPORT (independent report API)
// No-show appointments within the filtered window, meant to be paired with
// a WhatsApp recovery template.
// ======================================================

router.post(
    "/no-show-recovery",
    ...guard,
    reportsController.getNoShowRecoveryReport
);

// ======================================================
// CUSTOMER FREQUENCY REPORT (independent report API)
// Reads clients/sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/customer-frequency",
    ...guard,
    reportsController.getCustomerFrequencyReport
);

// ======================================================
// LOST CUSTOMERS REPORT (independent report API)
// Standalone report — separate from Customer Frequency's fixed 90-day
// "lost" bucket, with a user-configurable lost_days cutoff.
// ======================================================

router.post(
    "/lost-customers",
    ...guard,
    reportsController.getLostCustomersReport
);

// ======================================================
// CUSTOMER SPEND SEGMENTS REPORT (independent report API)
// Classifies clients VIP / Regular / Low against owner-set ₹ thresholds.
// Reads clients/sales directly, never the Appointment API.
// ======================================================

router.post(
    "/customer-spend",
    ...guard,
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
    ...guard,
    reportsController.getServiceFrequencyReport
);

// ======================================================
// MEMBERSHIP HISTORY REPORT (independent report API)
// One row per membership benefit redemption, read from
// membership_usage_log — the membership counterpart to Package History.
// ======================================================

router.post(
    "/membership-history",
    ...guard,
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
    ...guard,
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
    ...guard,
    reportsController.getPendingPaymentReport
);

// ======================================================
// CASH MANAGEMENT REPORT (independent report API)
// Reads cash_management directly — never calls the cash-management module's
// own service/repository, and never calls the Appointment API/service.
// ======================================================

router.post(
    "/cash-management",
    ...guard,
    reportsController.getCashManagementReport
);

// ======================================================
// REFERRAL REPORT (independent report API)
// One row per referred client, joined back to the referrer. Reads
// clients/sales/referral_ledger directly — never calls the Appointment API.
// ======================================================

router.post(
    "/referral",
    ...guard,
    reportsController.getReferralReport
);

// ======================================================
// CLIENT RATING REPORT (independent report API)
// Reads the reviews table directly — never calls into the reviews module's
// service/repository, and never calls the Appointment API/service.
// ======================================================

router.post(
    "/client-rating",
    ...guard,
    reportsController.getClientRatingReport
);

// ======================================================
// STAFF SALES REPORT (independent report API)
// Reads sale_items/sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-sales",
    ...guard,
    reportsController.getStaffSalesReport
);

// ======================================================
// STAFF PERFORMANCE REPORT (independent report API)
// Reads sales/sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-performance",
    ...guard,
    reportsController.getStaffPerformanceReport
);

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// Reads sale_items directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/staff-item-sales",
    ...guard,
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
    ...guard,
    reportsController.getRebookingRateReport
);

// ======================================================
// PAYROLL HISTORY REPORT (independent report API)
// Reads payroll_entries directly — never calls the Appointment API.
// ======================================================

router.post(
    "/payroll-history",
    ...guard,
    reportsController.getPayrollHistoryReport
);

// ======================================================
// PACKAGE SALE REPORT (independent report API)
// Reads client_packages directly — never calls the Appointment API.
// ======================================================

router.post(
    "/package-sale",
    ...guard,
    reportsController.getPackageSaleReport
);

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// Reads client_package_session_history directly — never calls the
// Appointment API.
// ======================================================

router.post(
    "/package-history",
    ...guard,
    reportsController.getPackageHistoryReport
);

// ======================================================
// MEMBER SALE REPORT (independent report API)
// Reads client_memberships directly — never calls the Appointment API.
// ======================================================

router.post(
    "/member-sale",
    ...guard,
    reportsController.getMemberSaleReport
);

// ======================================================
// APPOINTMENT DETAIL REPORT (independent report API)
// Reads the appointments table directly via SQL — never calls the
// Appointment HTTP API/service.
// ======================================================

router.post(
    "/appointment-detail",
    ...guard,
    reportsController.getAppointmentDetailReport
);

// ======================================================
// UPCOMING APPOINTMENTS REPORT (independent report API)
// Reads the appointments table directly via SQL — never calls the
// Appointment HTTP API/service. Scoped to future, still-booked appointments.
// ======================================================

router.post(
    "/upcoming-appointments",
    ...guard,
    reportsController.getUpcomingAppointmentsReport
);

// ======================================================
// WA MARKETING CAMPAIGN REPORT (independent report API)
// Reads wa_campaigns directly — never calls the campaigns HTTP API/service.
// ======================================================

router.post(
    "/wa-campaign",
    ...guard,
    reportsController.getWaCampaignReport
);

// ======================================================
// OPEN RATE REPORT (independent report API)
// Same data source as /wa-campaign above, different question: engagement
// (opened ÷ delivered) rather than delivery throughput.
// ======================================================

router.post(
    "/open-rate",
    ...guard,
    reportsController.getOpenRateReport
);

router.post(
    "/open-rate/campaign",
    ...guard,
    reportsController.getOpenRateCampaignDetail
);

// ======================================================
// BIRTHDAY CAMPAIGN PERFORMANCE REPORT (independent report API)
// Reads wa_automation_logs directly (event_type = 'birthday_wishes'), never
// through the whatsapp-automation module's own API.
// ======================================================

router.post(
    "/birthday-campaign",
    ...guard,
    reportsController.getBirthdayCampaignReport
);

// ======================================================
// REPLY RATE REPORT (independent report API)
// Replies are attributed by phone + a 24h window — see WA_REPLY_WINDOW in
// reports.repository.ts, since nothing links a message to a campaign.
// ======================================================

router.post(
    "/reply-rate",
    ...guard,
    reportsController.getReplyRateReport
);

router.post(
    "/reply-rate/campaign",
    ...guard,
    reportsController.getReplyRateCampaignDetail
);

export default router;
