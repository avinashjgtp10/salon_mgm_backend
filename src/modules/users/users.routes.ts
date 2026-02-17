
import { Router } from "express";
import { usersController } from "./users.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { protect } from "../../middleware/role.middleware";

const router = Router();

// Only logged-in users
router.get("/me", authMiddleware, usersController.me);

// Only ADMIN can list all users
router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin"),
  usersController.list
);

// Admin OR salon owner can view user by id
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "salon_owner"),
  usersController.getById
);


router.patch("/:id/role", authMiddleware, protect("admin"), usersController.updateRole);
// Only admin can delete users
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  usersController.remove
);

export default router;
