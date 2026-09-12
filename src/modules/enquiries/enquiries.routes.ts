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

const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Split from one shared view_enquiries key, which previously gated all 5
// CRUD actions including delete — a staff member who could view enquiries
// could always delete them too, since view_enquiries defaults true.
//
// respond_enquiries (create+update combined) has since been split further
// into add_enquiries/edit_enquiries — "Add Enquiry" and "Edit Enquiry" ticket
// requirement, each independently toggleable — see
// split_respond_enquiries_into_add_edit.sql.
const viewEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("view_enquiries")];
const addEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("add_enquiries")];
const editEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("edit_enquiries")];
const deleteEnquiries = [authMiddleware, ownerAdminStaff, requirePermission("delete_enquiries")];

router.get("/", ...viewEnquiries, enquiriesController.list);
router.get("/:id", ...viewEnquiries, enquiriesController.getById);
router.post("/", ...addEnquiries, enquiriesController.create);
router.patch("/:id", ...editEnquiries, enquiriesController.update);
router.delete("/:id", ...deleteEnquiries, enquiriesController.remove);

export default router;
