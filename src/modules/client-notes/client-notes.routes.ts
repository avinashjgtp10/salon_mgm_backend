import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { clientNotesController } from "./client-notes.controller";

const router = Router();

router.get(
  "/:clientId/notes",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  clientNotesController.list
);
router.post(
  "/:clientId/notes",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  clientNotesController.create
);
router.patch(
  "/:clientId/notes/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  clientNotesController.update
);
router.delete(
  "/:clientId/notes/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  clientNotesController.delete
);

export default router;
