import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { enquiriesController } from "./enquiries.controller";

const router = Router();

// featureKey "enquiries" — Basic tier and up by default, revocable per salon
// via feature_overrides.
router.use(authMiddleware, requirePlanFeature("enquiries"));

// Gated by view_enquiries — see permissionMatrix.ts on the frontend and
// DEFAULT_STAFF_PERMS in permission.middleware.ts, both of which must stay
// in sync with this key.
const authBase = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), requirePermission("view_enquiries")];

router.get("/", ...authBase, enquiriesController.list);
router.post("/", ...authBase, enquiriesController.create);
router.get("/:id", ...authBase, enquiriesController.getById);
router.patch("/:id", ...authBase, enquiriesController.update);
router.delete("/:id", ...authBase, enquiriesController.remove);

export default router;
