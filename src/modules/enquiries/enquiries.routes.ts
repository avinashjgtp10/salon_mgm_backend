import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { enquiriesController } from "./enquiries.controller";

const router = Router();
// Open to every authenticated salon user (owner/admin/staff) — no fine-grained
// permission gate, matching the frontend sidebar entry which isn't gated by
// usePermissions() either.
const authBase = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

router.get("/", ...authBase, enquiriesController.list);
router.post("/", ...authBase, enquiriesController.create);
router.get("/:id", ...authBase, enquiriesController.getById);
router.patch("/:id", ...authBase, enquiriesController.update);
router.delete("/:id", ...authBase, enquiriesController.remove);

export default router;
