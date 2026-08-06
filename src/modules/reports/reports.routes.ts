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
// CUSTOMER FREQUENCY REPORT (independent report API)
// Reads clients/sales directly — never calls the Appointment API/service.
// ======================================================

router.post(
    "/customer-frequency",
    ...guard,
    reportsController.getCustomerFrequencyReport
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
// WA MARKETING CAMPAIGN REPORT (independent report API)
// Reads wa_campaigns directly — never calls the campaigns HTTP API/service.
// ======================================================

router.post(
    "/wa-campaign",
    ...guard,
    reportsController.getWaCampaignReport
);

export default router;
