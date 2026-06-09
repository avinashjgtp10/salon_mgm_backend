import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { bundlesController, servicesController, servicesImportController } from "./services.controller";
import { upload } from "./services.upload";
import { downloadCatalogueCsv, downloadCatalogueExcel, downloadCataloguePdf } from "./services.download.controller.ts";
import {
  validateCreateAddOnGroup, validateCreateAddOnOption,
  validateCreateBundle, validateCreateService,
  validateUpdateAddOnGroup, validateUpdateAddOnOption,
  validateUpdateBundle, validateUpdateService,
} from "./services.validator";

const router = Router();
const authBase = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];
const authOwnerAdmin = [authMiddleware, roleMiddleware("salon_owner", "admin")];
const viewCatalog = requirePermission("view_catalog");
const editCatalog = requirePermission("edit_catalog");

// ─── Downloads (before /:id to avoid conflicts) ───────────────────────────────
router.get("/download/pdf",   ...authBase, viewCatalog, downloadCataloguePdf);
router.get("/download/excel", ...authBase, viewCatalog, downloadCatalogueExcel);
router.get("/download/csv",   ...authBase, viewCatalog, downloadCatalogueCsv);

// ─── Import ───────────────────────────────────────────────────────────────────
router.post("/import", ...authOwnerAdmin, upload.single("file"), servicesImportController.import);

// ─── Services CRUD ────────────────────────────────────────────────────────────
router.get("/",    ...authBase, viewCatalog, servicesController.list);
router.post("/",   ...authBase, editCatalog, validateCreateService, servicesController.create);
router.get("/:id", ...authBase, viewCatalog, servicesController.getById);
router.patch("/:id", ...authBase, editCatalog, validateUpdateService, servicesController.update);
router.delete("/:id", ...authBase, editCatalog, servicesController.remove);

// ─── Add-on groups ────────────────────────────────────────────────────────────
router.get("/:id/add-on-groups",          ...authBase, viewCatalog, servicesController.listAddOnGroups);
router.post("/:id/add-on-groups",         ...authBase, editCatalog, validateCreateAddOnGroup, servicesController.createAddOnGroup);
router.patch("/:id/add-on-groups/:groupId",  ...authBase, editCatalog, validateUpdateAddOnGroup, servicesController.updateAddOnGroup);
router.delete("/:id/add-on-groups/:groupId", ...authBase, editCatalog, servicesController.deleteAddOnGroup);

// ─── Add-on options ───────────────────────────────────────────────────────────
router.post("/:id/add-on-groups/:groupId/options",            ...authBase, editCatalog, validateCreateAddOnOption, servicesController.createAddOnOption);
router.patch("/:id/add-on-groups/:groupId/options/:optionId", ...authBase, editCatalog, validateUpdateAddOnOption, servicesController.updateAddOnOption);
router.delete("/:id/add-on-groups/:groupId/options/:optionId",...authBase, editCatalog, servicesController.deleteAddOnOption);

// ─── Bundles CRUD ─────────────────────────────────────────────────────────────
router.get("/bundles",    ...authBase, viewCatalog, bundlesController.list);
router.post("/bundles",   ...authBase, editCatalog, validateCreateBundle, bundlesController.create);
router.get("/bundles/:id", ...authBase, viewCatalog, bundlesController.getById);
router.patch("/bundles/:id", ...authBase, editCatalog, validateUpdateBundle, bundlesController.update);
router.delete("/bundles/:id", ...authBase, editCatalog, bundlesController.remove);

export default router;