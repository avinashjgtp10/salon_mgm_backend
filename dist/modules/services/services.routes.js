"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const services_controller_1 = require("./services.controller");
const services_download_controller_ts_1 = require("./services.download.controller.ts");
const services_validator_1 = require("./services.validator");
const router = (0, express_1.Router)();
const auth = [auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff")];
// ─── Downloads (before /:id to avoid conflicts) ───────────────────────────────
router.get("/download/pdf", ...auth, services_download_controller_ts_1.downloadCataloguePdf);
router.get("/download/excel", ...auth, services_download_controller_ts_1.downloadCatalogueExcel);
router.get("/download/csv", ...auth, services_download_controller_ts_1.downloadCatalogueCsv);
// ─── Services CRUD ────────────────────────────────────────────────────────────
router.get("/", ...auth, services_controller_1.servicesController.list);
router.post("/", ...auth, services_validator_1.validateCreateService, services_controller_1.servicesController.create);
router.get("/:id", ...auth, services_controller_1.servicesController.getById);
router.patch("/:id", ...auth, services_validator_1.validateUpdateService, services_controller_1.servicesController.update);
router.delete("/:id", ...auth, services_controller_1.servicesController.remove);
// ─── Add-on groups ────────────────────────────────────────────────────────────
router.get("/:id/add-on-groups", ...auth, services_controller_1.servicesController.listAddOnGroups);
router.post("/:id/add-on-groups", ...auth, services_validator_1.validateCreateAddOnGroup, services_controller_1.servicesController.createAddOnGroup);
router.patch("/:id/add-on-groups/:groupId", ...auth, services_validator_1.validateUpdateAddOnGroup, services_controller_1.servicesController.updateAddOnGroup);
router.delete("/:id/add-on-groups/:groupId", ...auth, services_controller_1.servicesController.deleteAddOnGroup);
// ─── Add-on options ───────────────────────────────────────────────────────────
router.post("/:id/add-on-groups/:groupId/options", ...auth, services_validator_1.validateCreateAddOnOption, services_controller_1.servicesController.createAddOnOption);
router.patch("/:id/add-on-groups/:groupId/options/:optionId", ...auth, services_validator_1.validateUpdateAddOnOption, services_controller_1.servicesController.updateAddOnOption);
router.delete("/:id/add-on-groups/:groupId/options/:optionId", ...auth, services_controller_1.servicesController.deleteAddOnOption);
// ─── Bundles CRUD ─────────────────────────────────────────────────────────────
router.get("/bundles", ...auth, services_controller_1.bundlesController.list);
router.post("/bundles", ...auth, services_validator_1.validateCreateBundle, services_controller_1.bundlesController.create);
router.get("/bundles/:id", ...auth, services_controller_1.bundlesController.getById);
router.patch("/bundles/:id", ...auth, services_validator_1.validateUpdateBundle, services_controller_1.bundlesController.update);
router.delete("/bundles/:id", ...auth, services_controller_1.bundlesController.remove);
exports.default = router;
//# sourceMappingURL=services.routes.js.map