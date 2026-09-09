import multer from "multer";
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { cashManagementController } from "./cash-management.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const guard = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];

// featureKey "cash_management" — Basic tier and up by default, revocable per
// salon via feature_overrides.
router.use(authMiddleware, requirePlanFeature("cash_management"));

router.post("/open", ...guard, cashManagementController.openCounter);
router.get("/cashdashboard", ...guard, cashManagementController.getDashboard);
router.get("/", ...guard, cashManagementController.listCounters);
router.get("/income", ...guard, cashManagementController.listCashIncomeEntries);
router.get("/expenses", ...guard, cashManagementController.listExpenses);
router.post("/expenses", ...guard, cashManagementController.createExpense);
router.put("/expenses/:id", ...guard, cashManagementController.updateExpense);
router.delete("/expenses/:id", ...guard, cashManagementController.deleteExpense);
router.post("/close", ...guard, cashManagementController.closeCounter);
router.post("/send-summary-email", ...guard, upload.single("file"), cashManagementController.sendSummaryEmail);
router.post("/email-summary", ...guard, upload.single("file"), cashManagementController.sendSummaryEmail);

export default router;