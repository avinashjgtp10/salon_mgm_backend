import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { reportsController } from "./reports.controller";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

// ── Analytics tabs ─────────────────────────────────────────────────────────────
router.get("/revenue",      ...guard, reportsController.getRevenue);
router.get("/appointments", ...guard, reportsController.getAppointments);
router.get("/clients",      ...guard, reportsController.getClients);
router.get("/staff",        ...guard, reportsController.getStaff);
router.get("/services",     ...guard, reportsController.getServices);

// ── Export ────────────────────────────────────────────────────────────────────
router.get("/export",       ...guard, reportsController.exportReport);

// ── Detail views ──────────────────────────────────────────────────────────────
router.get("/appointments/detail", ...guard, reportsController.getAppointmentsDetail);
router.get("/finance/detail",      ...guard, reportsController.getFinanceDetail);
router.get("/employee/detail",     ...guard, reportsController.getEmployeeDetail);

export default router;
