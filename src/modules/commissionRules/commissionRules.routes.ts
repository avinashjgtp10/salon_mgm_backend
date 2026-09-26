import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { commissionRulesController } from "./commissionRules.controller";
import {
    validateCreateCommissionRule,
    validateUpdateCommissionRule,
    validateUpdateCommissionRuleStatus,
} from "./commissionRules.validator";

const router = Router();
const auth = authMiddleware;
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Commission Rule CRUD previously had NO permission check at all (role-only,
// owner/admin excluding staff for writes) — now gated solely by the Tip &
// Commission ticket's own dedicated keys, no fallback to the older generic
// manage_commissions. Role widened to ownerAdminStaff so these are actually
// staff-delegable.
const viewCommissionRules = requirePermission("view_commissions");
const addCommissionRule = requirePermission("add_commission_rule");
const editCommissionRule = requirePermission("edit_commission_rule");
const deleteCommissionRule = requirePermission("delete_commission_rule");

router.get("/",    auth, ownerAdminStaff, viewCommissionRules, commissionRulesController.list);
router.get("/:id", auth, ownerAdminStaff, viewCommissionRules, commissionRulesController.getById);
router.get("/:id/progress", auth, ownerAdminStaff, viewCommissionRules, commissionRulesController.getTieredTargetProgress);

router.post("/",   auth, ownerAdminStaff, addCommissionRule, validateCreateCommissionRule, commissionRulesController.create);
router.patch("/:id", auth, ownerAdminStaff, editCommissionRule, validateUpdateCommissionRule, commissionRulesController.update);
router.patch("/:id/status", auth, ownerAdminStaff, editCommissionRule, validateUpdateCommissionRuleStatus, commissionRulesController.updateStatus);
router.delete("/:id", auth, ownerAdminStaff, deleteCommissionRule, commissionRulesController.delete);

export default router;
