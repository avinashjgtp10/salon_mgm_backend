import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { salonsController } from "./salons.controller";
import { validateCreateSalon, validateUpdateSalon } from "./salons.validator";

const router = Router();

router.post(
    "/",
    authMiddleware,
    validateCreateSalon,
    salonsController.create
);

router.get(
    "/me",
    authMiddleware,
    salonsController.mySalon
);

router.get("/", authMiddleware, roleMiddleware("admin"), salonsController.listAll);

router.get("/:id", authMiddleware, salonsController.getById);

router.patch(
    "/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateSalon,
    salonsController.update
);

export default router;
