import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { salonDashboardController } from "./salon-dashboard.controller";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), requirePermission("view_dashboard")];

// GET /api/v1/dashboard/revenue — "Revenue Overview" chart card
router.get("/revenue", ...guard, requirePermission("view_dashboard_card_revenue_overview"), salonDashboardController.getRevenueChart);

// GET /api/v1/dashboard/monthly-projection — "Monthly Projection & Growth"
// card, which replaced the Revenue Overview card (same permission key).
router.get("/monthly-projection", ...guard, requirePermission("view_dashboard_card_revenue_overview"), salonDashboardController.getMonthlyProjection);

// PUT /api/v1/dashboard/monthly-target — set/clear the salon's monthly sales
// target. Owner/admin only: it is a business goal, not something staff edit.
router.put("/monthly-target", authMiddleware, roleMiddleware("salon_owner", "admin"), requirePermission("view_dashboard"), salonDashboardController.setMonthlyTarget);

// GET /api/v1/dashboard/payment-mode-breakdown — "Overall Collection" card
router.get("/payment-mode-breakdown", ...guard, requirePermission("view_dashboard_card_overall_collection"), salonDashboardController.getPaymentModeBreakdown);

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
