import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { reportsController } from "./reports.controller";

const router = Router();

const guard = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];

// ── Reports Dashboard (32 reports listing) ────────────────────────────────────
router.get("/",             ...guard, reportsController.getReportsDashboard);

// ── Analytics tabs ─────────────────────────────────────────────────────────────
router.get("/revenue",      ...guard, reportsController.getRevenue);
router.get("/revenue-by-service", ...guard, reportsController.getRevenueByService);
router.get("/revenue-by-service/:serviceId/detail", ...guard, reportsController.getRevenueByServiceDetail);
router.get("/service-revenue-by-category", ...guard, reportsController.getRevenueByServiceCategory);
router.get("/service-revenue-by-category/:categoryId", ...guard, reportsController.getRevenueByServiceCategoryDetail);
router.get("/appointments", ...guard, reportsController.getAppointments);
router.get("/clients",      ...guard, reportsController.getClients);
router.get("/staff",        ...guard, reportsController.getStaff);
router.get("/services",     ...guard, reportsController.getServices);
router.get("/employee-performance", ...guard, reportsController.getEmployeePerformance);
router.get("/staff-revenue-analytics", ...guard, reportsController.getStaffRevenueAnalytics);
router.get("/staff-product-sales", ...guard, reportsController.getStaffProductSales);
router.get("/staff-service-sales", ...guard, reportsController.getStaffServiceSales);
router.get("/sales-dashboard", ...guard, reportsController.getSalesDashboard);

// ── Export ────────────────────────────────────────────────────────────────────
router.get("/export",       ...guard, reportsController.exportReport);

// ── Detail views ──────────────────────────────────────────────────────────────
router.get("/appointments/detail", ...guard, reportsController.getAppointmentsDetail);
router.get("/finance/detail",      ...guard, reportsController.getFinanceDetail);
router.get("/inventory/detail",    ...guard, reportsController.getInventoryDetail);
router.get("/payments/detail",     ...guard, reportsController.getPaymentsDetail);
router.get("/daily/detail",        ...guard, reportsController.getDailyDetail);
router.get("/marketing/detail",    ...guard, reportsController.getMarketingDetail);
router.get("/employee/detail",     ...guard, reportsController.getEmployeeDetail);
router.get("/revenue-by-category/:categoryId", ...guard, reportsController.getRevenueByServiceCategoryDetail);

export default router;
