import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { assetsController as c } from "./assets.controller";

// Catalog → Tool Tracking. Every route is salon-scoped through the JWT's salonId; each
// action has its own permission key (see Migration/create_tool_tracking.sql).
const router = Router();
const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

const view = requirePermission("view_assets");
const viewHistory = requirePermission("view_asset_history");
const manage = requirePermission("manage_assets");
const issueReturn = requirePermission("issue_return_assets");
const report = requirePermission("report_asset_incidents");
const investigate = requirePermission("manage_asset_investigations");

// Static paths first — otherwise "/:id" swallows them.
router.get("/categories", ...guard, view, c.categories);
router.post("/categories", ...guard, manage, c.addCategory);
router.get("/brands", ...guard, view, c.brands);
router.post("/brands", ...guard, manage, c.addBrand);
router.delete("/categories", ...guard, manage, c.deleteCategory);
router.get("/incidents", ...guard, view, c.listIncidents);
router.patch("/incidents/:incidentId", ...guard, investigate, c.updateIncident);
router.post("/upload-photo", ...guard, requireAnyPermission(["manage_assets", "report_asset_incidents"]), uploadMiddleware.single("photo"), c.uploadPhoto);

router.get("/", ...guard, view, c.list);
router.post("/", ...guard, manage, c.create);
router.get("/:id", ...guard, view, c.get);
router.patch("/:id", ...guard, manage, c.update);
router.get("/:id/history", ...guard, viewHistory, c.history);
router.post("/:id/issue", ...guard, issueReturn, c.issue);
router.post("/:id/return", ...guard, issueReturn, c.returnAsset);
router.post("/:id/incidents", ...guard, report, c.reportIncident);
router.post("/:id/maintenance", ...guard, manage, c.maintenance);
router.post("/:id/retire", ...guard, manage, c.retire);
router.post("/:id/clear-inspection", ...guard, investigate, c.clearInspection);

export default router;
