import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { salonGroupsController } from "./salon-groups.controller";

const router = Router();

// Super Admin only — grouping multiple salons owned by the same person so
// that owner can later switch between their own salons from one login.
router.use(authMiddleware, superAdminMiddleware);

router.get("/ungrouped-salons",        salonGroupsController.getUngroupedSalonsForOwner);
router.get("/",                        salonGroupsController.list);
router.post("/",                       salonGroupsController.create);
router.delete("/:id",                  salonGroupsController.remove);
router.post("/:id/salons",             salonGroupsController.addSalon);
router.delete("/:id/salons/:salonId",  salonGroupsController.removeSalon);
router.post("/:id/set-credentials",    salonGroupsController.setCredentials);

export default router;
