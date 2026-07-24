import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { pricingController } from "./pricing.controller";

const router = Router();

// Read-only preview, no money movement or writes — any authenticated salon
// staff member may call it (the actual create/checkout endpoints downstream
// still have their own tighter permission gates).
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.post("/calculate-totals", authMiddleware, ownerAdminStaff, pricingController.calculateTotals);

export default router;
