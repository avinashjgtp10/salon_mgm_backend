import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { salonDashboardController } from "./salon-dashboard.controller";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), requirePermission("view_dashboard")];

// GET /api/v1/dashboard/revenue
router.get("/revenue", ...guard, requirePermission("view_dashboard_financials"), salonDashboardController.getRevenueChart);

// GET /api/v1/dashboard/payment-mode-breakdown — "Overall Collection" card
router.get("/payment-mode-breakdown", ...guard, requirePermission("view_dashboard_financials"), salonDashboardController.getPaymentModeBreakdown);

// GET /api/v1/dashboard/staff/top
router.get("/staff/top", ...guard, requirePermission("view_dashboard_staff_performance"), salonDashboardController.getTopStaff);

// GET /api/v1/dashboard/staff/revenue
router.get("/staff/revenue", ...guard, requirePermission("view_dashboard_staff_performance"), salonDashboardController.getStaffRevenue);

// GET /api/v1/dashboard/services/mix
router.get("/services/mix", ...guard, salonDashboardController.getServiceMix);

// POST /api/v1/dashboard — bundles summary, live today's appointments,
// revenue chart, pending payments, birthdays, and the Overall Collection
// breakdown in one call (replaces GET /all + the frontend's separate
// GET /appointments and GET /payment-mode-breakdown calls). POST because the
// Overall Collection filter travels in the body. Field-level filtering by
// sub-permission happens inside the controller, since this is one bundled
// response covering financial/appointment/client-info data at different
// sensitivity levels; base view_dashboard is the only route-level gate here.
router.post("/", ...guard, salonDashboardController.getCombined);

export default router;
