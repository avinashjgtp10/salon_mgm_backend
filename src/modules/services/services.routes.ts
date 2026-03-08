import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { bundlesController, servicesController } from "./services.controller";
import { downloadCatalogueCsv, downloadCatalogueExcel, downloadCataloguePdf } from "./services.download.controller.ts";
import {
  validateCreateAddOnGroup, validateCreateAddOnOption,
  validateCreateBundle, validateCreateService,
  validateUpdateAddOnGroup, validateUpdateAddOnOption,
  validateUpdateBundle, validateUpdateService,
} from "./services.validator";

const router = Router();
const auth = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

// ─── Downloads (before /:id to avoid conflicts) ───────────────────────────────
router.get("/download/pdf",   ...auth, downloadCataloguePdf);
router.get("/download/excel", ...auth, downloadCatalogueExcel);
router.get("/download/csv",   ...auth, downloadCatalogueCsv);

// ─── Services CRUD ────────────────────────────────────────────────────────────
router.get("/",    ...auth, servicesController.list);
router.post("/",   ...auth, validateCreateService, servicesController.create);
router.get("/:id", ...auth, servicesController.getById);
router.patch("/:id", ...auth, validateUpdateService, servicesController.update);
router.delete("/:id", ...auth, servicesController.remove);

// ─── Add-on groups ────────────────────────────────────────────────────────────
router.get("/:id/add-on-groups",          ...auth, servicesController.listAddOnGroups);
router.post("/:id/add-on-groups",         ...auth, validateCreateAddOnGroup, servicesController.createAddOnGroup);
router.patch("/:id/add-on-groups/:groupId",  ...auth, validateUpdateAddOnGroup, servicesController.updateAddOnGroup);
router.delete("/:id/add-on-groups/:groupId", ...auth, servicesController.deleteAddOnGroup);

// ─── Add-on options ───────────────────────────────────────────────────────────
router.post("/:id/add-on-groups/:groupId/options",            ...auth, validateCreateAddOnOption, servicesController.createAddOnOption);
router.patch("/:id/add-on-groups/:groupId/options/:optionId", ...auth, validateUpdateAddOnOption, servicesController.updateAddOnOption);
router.delete("/:id/add-on-groups/:groupId/options/:optionId",...auth, servicesController.deleteAddOnOption);

// ─── Bundles CRUD ─────────────────────────────────────────────────────────────
router.get("/bundles",    ...auth, bundlesController.list);
router.post("/bundles",   ...auth, validateCreateBundle, bundlesController.create);
router.get("/bundles/:id", ...auth, bundlesController.getById);
router.patch("/bundles/:id", ...auth, validateUpdateBundle, bundlesController.update);
router.delete("/bundles/:id", ...auth, bundlesController.remove);

export default router;