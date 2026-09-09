import multer from "multer";
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { cashManagementController } from "./cash-management.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const guard = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
const viewCash = requirePermission("view_cash_management");
const manageRegister = requirePermission("manage_cash_register");
const manageTransactions = requirePermission("manage_cash_transactions");

// featureKey "cash_management" — Basic tier and up by default, revocable per
// salon via feature_overrides.
router.use(authMiddleware, requirePlanFeature("cash_management"));

router.post("/open", ...guard, manageRegister, cashManagementController.openCounter);
router.get("/cashdashboard", ...guard, viewCash, cashManagementController.getDashboard);
router.get("/", ...guard, viewCash, cashManagementController.listCounters);
router.get("/income", ...guard, viewCash, cashManagementController.listCashIncomeEntries);
router.get("/expenses", ...guard, viewCash, cashManagementController.listExpenses);
router.post("/expenses", ...guard, manageTransactions, cashManagementController.createExpense);
router.put("/expenses/:id", ...guard, manageTransactions, cashManagementController.updateExpense);
router.delete("/expenses/:id", ...guard, manageTransactions, cashManagementController.deleteExpense);
router.post("/close", ...guard, manageRegister, cashManagementController.closeCounter);
router.post("/send-summary-email", ...guard, viewCash, upload.single("file"), cashManagementController.sendSummaryEmail);
router.post("/email-summary", ...guard, viewCash, upload.single("file"), cashManagementController.sendSummaryEmail);

export default router;