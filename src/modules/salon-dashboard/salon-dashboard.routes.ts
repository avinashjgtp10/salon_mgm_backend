import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { salonDashboardController } from "./salon-dashboard.controller";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), requirePermission("view_dashboard")];

// GET /api/v1/dashboard/summary
router.get("/summary", ...guard, salonDashboardController.getSummary);

// GET /api/v1/dashboard/revenue
router.get("/revenue", ...guard, requirePermission("view_dashboard_financials"), salonDashboardController.getRevenueChart);

// GET /api/v1/dashboard/appointments/today
router.get("/appointments/today", ...guard, salonDashboardController.getTodayAppointments);

// GET /api/v1/dashboard/staff/top
router.get("/staff/top", ...guard, requirePermission("view_dashboard_staff_performance"), salonDashboardController.getTopStaff);

// GET /api/v1/dashboard/staff/revenue
router.get("/staff/revenue", ...guard, requirePermission("view_dashboard_staff_performance"), salonDashboardController.getStaffRevenue);

// GET /api/v1/dashboard/services/mix
router.get("/services/mix", ...guard, salonDashboardController.getServiceMix);

// GET /api/v1/dashboard/all — field-level filtering by sub-permission happens
// inside the controller, since this is one bundled response covering
// financial/staff-performance/client-info data at different sensitivity
// levels; base view_dashboard is the only route-level gate here.
router.get("/all", ...guard, salonDashboardController.getAll);

export default router;
