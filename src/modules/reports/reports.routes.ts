import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { subscriptionMiddleware } from "../../middleware/subscription.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { reportsController } from "./reports.controller";

const router = Router();

const guard = [
    authMiddleware,
    subscriptionMiddleware,
    roleMiddleware("salon_owner", "admin", "staff", "super_admin"),
    requirePermission("view_reports"),
];

// ======================================================
// SALES SUMMARY
// ======================================================

router.get(
    "/sales-summary",
    ...guard,
    reportsController.getSalesSummary
);

router.get(
    "/sales-summary/table",
    ...guard,
    reportsController.getSalesSummaryTable
);

// ======================================================
// PRODUCT REVENUE REPORT
// ======================================================

router.get(
    "/product-revenue",
    ...guard,
    reportsController.getProductRevenueReport
);

router.get(
    "/product-revenue/table",
    ...guard,
    reportsController.getProductRevenueTable
);

// ======================================================
// STAFF REVENUE REPORT
// ======================================================

router.get(
    "/service-revenue",
    ...guard,
    reportsController.getServiceRevenue
);

router.get(
    "/service-revenue/table",
    ...guard,
    reportsController.getServiceRevenueTable
);

router.get(
    "/stylist-revenue",
    ...guard,
    reportsController.getStylistRevenue
);

router.get(
    "/stylist-revenue/table",
    ...guard,
    reportsController.getStylistRevenueTable
);

router.get(
    "/staff-commission",
    ...guard,
    reportsController.getStaffCommissionReport
);

router.get(
    "/staff-commission/table",
    ...guard,
    reportsController.getStaffCommissionTable
);

router.get(
    "/tip-report",
    ...guard,
    reportsController.getTipReport
);

router.get(
    "/tip-report/table",
    ...guard,
    reportsController.getTipReportTable
);

router.get(
    "/appointment-report",
    ...guard,
    reportsController.getAppointmentReport
);

router.get(
    "/appointment-report/table",
    ...guard,
    reportsController.getAppointmentReportTable
);

router.get(
    "/appointment-detail/table",
    ...guard,
    reportsController.getAppointmentDetailTable
);

router.get(
    "/daily-sheet/table",
    ...guard,
    reportsController.getDailySheetTable
);

router.get(
    "/reward-points/table",
    ...guard,
    reportsController.getRewardPointsSummary
);

router.get(
    "/service-reminder",
    ...guard,
    reportsController.getServiceReminderReport
);

router.get(
    "/service-reminder/table",
    ...guard,
    reportsController.getServiceReminderTable
);

router.get(
    "/guest-collection",
    ...guard,
    reportsController.getGuestCollectionReport
);

router.get(
    "/guest-collection/table",
    ...guard,
    reportsController.getGuestCollectionTable
);

router.get(
    "/staff-attendance",
    ...guard,
    reportsController.getStaffAttendanceReport
);

router.get(
    "/staff-attendance/table",
    ...guard,
    reportsController.getStaffAttendanceTable
);

router.get(
    "/balance-received",
    ...guard,
    reportsController.getBalanceReceivedReport
);

router.get(
    "/balance-received/table",
    ...guard,
    reportsController.getBalanceReceivedTable
);

router.get(
    "/day-wise",
    ...guard,
    reportsController.getDayWiseReport
);

router.get(
    "/day-wise/table",
    ...guard,
    reportsController.getDayWiseTable
);

router.get(
    "/coupon-redemption",
    ...guard,
    reportsController.getCouponRedemptionReport
);

router.get(
    "/coupon-redemption/table",
    ...guard,
    reportsController.getCouponRedemptionTable
);

export default router;
