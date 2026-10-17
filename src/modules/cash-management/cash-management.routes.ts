import multer from "multer";
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { cashManagementController } from "./cash-management.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const guard = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
const viewCash = requirePermission("view_cash_management");
// Cash Management ticket: Open Counter/Close Counter and Add/Edit/Delete
// Expenses each get their own dedicated toggle — replacing the older
// combined manage_cash_register/manage_cash_transactions keys (never
// granted to anyone yet, per a live-DB check, so this is a clean split, not
// a breaking change). Export PDF/Excel/CSV are frontend-only (client-side
// jsPDF/xlsx generation from already-fetched data, see
// cashManagement.export.ts) — no backend route to gate.
const openCounter = requirePermission("open_counter");
const closeCounter = requirePermission("close_counter");
const addExpense = requirePermission("add_expense");
const editExpense = requirePermission("edit_expense");
const deleteExpense = requirePermission("delete_expense");

router.use(authMiddleware);

router.post("/open", ...guard, openCounter, cashManagementController.openCounter);
router.get("/cashdashboard", ...guard, viewCash, cashManagementController.getDashboard);
// Close Counter modal: its own small request (today's Cash/UPI/Card + expected closing) instead of the Home-page dashboard bundle.
router.get("/close-summary", ...guard, closeCounter, cashManagementController.getCloseSummary);
router.get("/", ...guard, viewCash, cashManagementController.listCounters);
router.get("/income", ...guard, viewCash, cashManagementController.listCashIncomeEntries);
router.get("/expenses", ...guard, viewCash, cashManagementController.listExpenses);
// Consolidates GET /cashdashboard, GET / (counters), GET /expenses and
// GET /api/v1/dashboard/summary into one call — payload's `sections` picks
// which of those to run.
router.post("/summary-bundle", ...guard, viewCash, cashManagementController.getSummaryBundle);
router.post("/expenses", ...guard, addExpense, cashManagementController.createExpense);
router.put("/expenses/:id", ...guard, editExpense, cashManagementController.updateExpense);
router.delete("/expenses/:id", ...guard, deleteExpense, cashManagementController.deleteExpense);
router.post("/close", ...guard, closeCounter, cashManagementController.closeCounter);
router.post("/resend-closed-message", ...guard, viewCash, cashManagementController.resendClosedCounterMessage);
router.post("/send-summary-email", ...guard, viewCash, upload.single("file"), cashManagementController.sendSummaryEmail);
router.post("/email-summary", ...guard, viewCash, upload.single("file"), cashManagementController.sendSummaryEmail);

export default router;