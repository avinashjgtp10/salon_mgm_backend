import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { bundlesController, servicesController, servicesImportController } from "./services.controller";
import { upload } from "./services.upload";
import { downloadCatalogueCsv, downloadCatalogueExcel, downloadCataloguePdf } from "./services.download.controller.ts";
import {
  validateCreateAddOnGroup, validateCreateAddOnOption,
  validateCreateBundle, validateCreateConsultationForm, validateCreateService,
  validateUpdateAddOnGroup, validateUpdateAddOnOption,
  validateUpdateBundle, validateUpdateConsultationForm, validateUpdateService,
} from "./services.validator";

const router = Router();
const authBase = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];
const authOwnerAdmin = [authMiddleware, roleMiddleware("salon_owner", "admin")];
// Quick Sale and Calendar both need to read services to build a sale/
// appointment, even for staff who weren't separately granted Catalog view.
const viewServices = requireAnyPermission(["view_services", "create_sales", "manage_calendar"]);
const createServices = requirePermission("create_services");
const editServices = requirePermission("edit_services");

// ─── Downloads (before /:id to avoid conflicts) ───────────────────────────────
router.get("/download/pdf",   ...authBase, viewServices, downloadCataloguePdf);
router.get("/download/excel", ...authBase, viewServices, downloadCatalogueExcel);
router.get("/download/csv",   ...authBase, viewServices, downloadCatalogueCsv);

// ─── Import ───────────────────────────────────────────────────────────────────
router.post("/import", ...authOwnerAdmin, upload.single("file"), servicesImportController.import);

// ─── Services CRUD ────────────────────────────────────────────────────────────
router.get("/",    ...authBase, viewServices, servicesController.list);
router.post("/",   ...authBase, createServices, validateCreateService, servicesController.create);
router.get("/:id", ...authBase, viewServices, servicesController.getById);
router.patch("/:id", ...authBase, editServices, validateUpdateService, servicesController.update);
router.delete("/:id", ...authBase, editServices, servicesController.remove);

// ─── Add-on groups ────────────────────────────────────────────────────────────
router.get("/:id/add-on-groups",          ...authBase, viewServices, servicesController.listAddOnGroups);
router.post("/:id/add-on-groups",         ...authBase, createServices, validateCreateAddOnGroup, servicesController.createAddOnGroup);
router.patch("/:id/add-on-groups/:groupId",  ...authBase, editServices, validateUpdateAddOnGroup, servicesController.updateAddOnGroup);
router.delete("/:id/add-on-groups/:groupId", ...authBase, editServices, servicesController.deleteAddOnGroup);

// ─── Add-on options ───────────────────────────────────────────────────────────
router.post("/:id/add-on-groups/:groupId/options",            ...authBase, createServices, validateCreateAddOnOption, servicesController.createAddOnOption);
router.patch("/:id/add-on-groups/:groupId/options/:optionId", ...authBase, editServices, validateUpdateAddOnOption, servicesController.updateAddOnOption);
router.delete("/:id/add-on-groups/:groupId/options/:optionId",...authBase, editServices, servicesController.deleteAddOnOption);

// ─── Consultation forms ───────────────────────────────────────────────────────
router.get("/:id/consultation-forms",           ...authBase, viewServices, servicesController.listConsultationForms);
router.post("/:id/consultation-forms",          ...authBase, createServices, validateCreateConsultationForm, servicesController.createConsultationForm);
router.patch("/:id/consultation-forms/:formId", ...authBase, editServices, validateUpdateConsultationForm, servicesController.updateConsultationForm);
router.delete("/:id/consultation-forms/:formId",...authBase, editServices, servicesController.deleteConsultationForm);

// ─── Bundles CRUD ─────────────────────────────────────────────────────────────
router.get("/bundles",    ...authBase, viewServices, bundlesController.list);
router.post("/bundles",   ...authBase, createServices, validateCreateBundle, bundlesController.create);
router.get("/bundles/:id", ...authBase, viewServices, bundlesController.getById);
router.patch("/bundles/:id", ...authBase, editServices, validateUpdateBundle, bundlesController.update);
router.delete("/bundles/:id", ...authBase, editServices, bundlesController.remove);

export default router;