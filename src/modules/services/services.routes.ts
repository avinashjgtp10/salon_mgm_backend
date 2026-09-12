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
// Quick Sale and Calendar both need to read services to build a sale/
// appointment, even for staff who weren't separately granted Catalog view.
const viewServices = requireAnyPermission(["view_services", "create_sales", "manage_calendar"]);
const createServices = requirePermission("create_services");
const editServices = requirePermission("edit_services");
// Delete Service is its own dedicated permission now (see the Service Menu
// permissions ticket) — OR'd with edit_services so existing role/staff
// grants that only ever set edit_services keep working unchanged.
const deleteServices = requireAnyPermission(["delete_services", "edit_services"]);
// Import/Export Services are their own dedicated permissions (Service Menu
// permissions ticket). import_file/export_pdf/csv/excel (System) are now
// global master gates, not OR'd fallbacks — BOTH the specific permission
// AND the matching global switch are required (Global Download Switches
// ticket).
const importServices = [requirePermission("import_services"), requirePermission("import_file")];
const exportServicePdf = [requirePermission("download_service_menu_pdf"), requirePermission("export_pdf")];
const exportServiceExcel = [requirePermission("download_service_menu_excel"), requirePermission("export_excel")];
const exportServiceCsv = [requirePermission("download_service_menu_csv"), requirePermission("export_csv")];

// ─── Downloads (before /:id to avoid conflicts) ───────────────────────────────
router.get("/download/pdf",   ...authBase, viewServices, ...exportServicePdf,   downloadCataloguePdf);
router.get("/download/excel", ...authBase, viewServices, ...exportServiceExcel, downloadCatalogueExcel);
router.get("/download/csv",   ...authBase, viewServices, ...exportServiceCsv,   downloadCatalogueCsv);

// ─── Import ───────────────────────────────────────────────────────────────────
router.post("/import", ...authBase, ...importServices, upload.single("file"), servicesImportController.import);

// ─── Services CRUD ────────────────────────────────────────────────────────────
router.get("/",    ...authBase, viewServices, servicesController.list);
router.post("/",   ...authBase, createServices, validateCreateService, servicesController.create);
router.get("/:id", ...authBase, viewServices, servicesController.getById);
router.patch("/:id", ...authBase, editServices, validateUpdateService, servicesController.update);
router.delete("/:id", ...authBase, deleteServices, servicesController.remove);

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