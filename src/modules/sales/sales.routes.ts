import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { salesController } from "./sales.controller";
import {
    validateCreateSale, validateUpdateSale, validateCheckoutSale,
} from "./sales.validator";

const router = Router();

router.post("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateCreateSale, salesController.create);
router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), salesController.list);
router.get("/summary", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), salesController.getDailySummary);
router.get("/export", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), salesController.exportSales);
router.get("/init", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), salesController.getInit);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), salesController.getById);
router.patch("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateUpdateSale, salesController.update);
router.delete("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), salesController.delete);
router.post("/:id/checkout", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateCheckoutSale, salesController.checkout);

export default router;
