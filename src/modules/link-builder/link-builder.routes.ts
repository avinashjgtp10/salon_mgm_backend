import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { linkBuilderController } from "./link-builder.controller";

const router = Router();

router.post(
    "/generate",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    linkBuilderController.generate
);

export default router;
