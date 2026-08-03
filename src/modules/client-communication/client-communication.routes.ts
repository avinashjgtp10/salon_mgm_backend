import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { clientCommunicationController } from "./client-communication.controller";

const router = Router();

router.get(
  "/:clientId/communications",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  clientCommunicationController.list
);

export default router;
