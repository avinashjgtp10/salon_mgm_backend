import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { commissionRulesController } from "./commissionRules.controller";
import {
    validateCreateCommissionRule,
    validateUpdateCommissionRule,
    validateUpdateCommissionRuleStatus,
} from "./commissionRules.validator";

const router = Router();
const auth = authMiddleware;
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.get("/",    auth, ownerAdminStaff, commissionRulesController.list);
router.get("/:id", auth, ownerAdminStaff, commissionRulesController.getById);

router.post("/",   auth, ownerAdmin, validateCreateCommissionRule, commissionRulesController.create);
router.patch("/:id", auth, ownerAdmin, validateUpdateCommissionRule, commissionRulesController.update);
router.patch("/:id/status", auth, ownerAdmin, validateUpdateCommissionRuleStatus, commissionRulesController.updateStatus);
router.delete("/:id", auth, ownerAdmin, commissionRulesController.delete);

export default router;
