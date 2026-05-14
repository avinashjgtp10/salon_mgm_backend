import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { salonDashboardController } from "./salon-dashboard.controller";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

// GET /api/v1/dashboard/summary
router.get("/summary", ...guard, salonDashboardController.getSummary);

// GET /api/v1/dashboard/revenue
router.get("/revenue", ...guard, salonDashboardController.getRevenueChart);

// GET /api/v1/dashboard/appointments/today
router.get("/appointments/today", ...guard, salonDashboardController.getTodayAppointments);

// GET /api/v1/dashboard/staff/top
router.get("/staff/top", ...guard, salonDashboardController.getTopStaff);

// GET /api/v1/dashboard/services/mix
router.get("/services/mix", ...guard, salonDashboardController.getServiceMix);

// GET /api/v1/dashboard/all
router.get("/all", ...guard, salonDashboardController.getAll);

export default router;
