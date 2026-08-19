import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { branchOwnerController } from "./branch-owner.controller";

const router = Router();

router.use(authMiddleware, roleMiddleware("branch_owner"));

router.get("/salons",            branchOwnerController.getMySalons);
router.post("/salons/:id/enter", branchOwnerController.enterSalon);

export default router;
