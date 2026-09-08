import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { enquiriesController } from "./enquiries.controller";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Split from one shared view_enquiries key, which previously gated all 5
// CRUD actions including delete — a staff member who could view enquiries
// could always delete them too, since view_enquiries defaults true.
const viewEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("view_enquiries")];
const respondEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("respond_enquiries")];
const deleteEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("delete_enquiries")];

router.get("/", ...viewEnquiries, enquiriesController.list);
router.get("/:id", ...viewEnquiries, enquiriesController.getById);
router.post("/", ...respondEnquiries, enquiriesController.create);
router.patch("/:id", ...respondEnquiries, enquiriesController.update);
router.delete("/:id", ...deleteEnquiries, enquiriesController.remove);

export default router;
