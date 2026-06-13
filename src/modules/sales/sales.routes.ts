import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { salesController } from "./sales.controller";
import {
    validateCreateSale, validateUpdateSale, validateCheckoutSale,
} from "./sales.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.post("/", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCreateSale, salesController.create);
router.get("/", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.list);
router.get("/summary", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.getDailySummary);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.exportSales);
router.get("/init", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.getInit);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("view_sales"), salesController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateUpdateSale, salesController.update);
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCheckoutSale, salesController.checkout);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.delete);

export default router;
