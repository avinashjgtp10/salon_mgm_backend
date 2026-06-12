import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { reportsController } from "./reports.controller";

const router = Router();

const guard = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];

// ── Reports Dashboard (listing) ───────────────────────────────────────────────
router.get("/",             ...guard, reportsController.getReportsDashboard);

// ── Analytics tabs ─────────────────────────────────────────────────────────────
router.get("/revenue",      ...guard, reportsController.getRevenue);
router.get("/appointments", ...guard, reportsController.getAppointments);
router.get("/clients",      ...guard, reportsController.getClients);
router.get("/staff",        ...guard, reportsController.getStaff);
router.get("/services",     ...guard, reportsController.getServices);

// ── Export ────────────────────────────────────────────────────────────────────
router.get("/export",       ...guard, reportsController.exportReport);

// ── Detail views — original ───────────────────────────────────────────────────
router.get("/appointments/detail",        ...guard, reportsController.getAppointmentsDetail);
router.get("/finance/detail",             ...guard, reportsController.getFinanceDetail);
router.get("/inventory/detail",           ...guard, reportsController.getInventoryDetail);
router.get("/payments/detail",            ...guard, reportsController.getPaymentsDetail);
router.get("/daily/detail",               ...guard, reportsController.getDailyDetail);
router.get("/marketing/detail",           ...guard, reportsController.getMarketingDetail);
router.get("/employee/detail",            ...guard, reportsController.getEmployeeDetail);

// ── Detail views — newly implemented ─────────────────────────────────────────
router.get("/client-retention/detail",    ...guard, reportsController.getClientRetentionDetail);
router.get("/inventory-consumption/detail",...guard, reportsController.getInventoryConsumptionDetail);
router.get("/payment-summary/detail",     ...guard, reportsController.getPaymentSummaryDetail);
router.get("/commissions/detail",         ...guard, reportsController.getCommissionsDetail);
router.get("/no-show/detail",             ...guard, reportsController.getNoShowCancellationDetail);
router.get("/staffing/detail",            ...guard, reportsController.getStaffingDetail);
router.get("/leaves/detail",              ...guard, reportsController.getLeavesDetail);

export default router;