"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const staff_controller_1 = require("./staff.controller");
const staff_validator_1 = require("./staff.validator");
const router = (0, express_1.Router)();
const auth = auth_middleware_1.authMiddleware;
const ownerAdmin = (0, role_middleware_1.roleMiddleware)("salon_owner", "admin");
const ownerAdminStaff = (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff");
// ─── Public (no auth) ─────────────────────────────────────────────────────────
router.get("/invite/:token/verify", staff_controller_1.staffInvitationController.verifyToken);
router.post("/invite/accept", staff_validator_1.validateAcceptInvitation, staff_controller_1.staffInvitationController.acceptInvitation);
// ─── Staff CRUD ───────────────────────────────────────────────────────────────
router.get("/", auth, ownerAdminStaff, staff_controller_1.staffController.list);
router.post("/", auth, ownerAdmin, staff_validator_1.validateCreateStaff, staff_controller_1.staffController.create);
// ─── Export (must be BEFORE /:id to avoid wildcard collision) ─────────────────
router.get("/export/excel", auth, ownerAdmin, staff_controller_1.staffController.exportExcel);
router.get("/export/csv", auth, ownerAdmin, staff_controller_1.staffController.exportCsv);
router.get("/:id", auth, ownerAdminStaff, staff_controller_1.staffController.getById);
router.patch("/:id", auth, ownerAdmin, staff_validator_1.validateUpdateStaff, staff_controller_1.staffController.update);
router.delete("/:id", auth, ownerAdmin, staff_controller_1.staffController.deactivate);
// ─── Invitation management ────────────────────────────────────────────────────
router.post("/:id/resend-invite", auth, ownerAdmin, staff_controller_1.staffInvitationController.resendInvitation);
router.delete("/:id/cancel-invite", auth, ownerAdmin, staff_controller_1.staffInvitationController.cancelInvitation);
// ─── Addresses ────────────────────────────────────────────────────────────────
router.get("/:staffId/addresses", auth, ownerAdminStaff, staff_controller_1.staffAddressController.list);
router.post("/:staffId/addresses", auth, ownerAdmin, staff_validator_1.validateCreateStaffAddress, staff_controller_1.staffAddressController.create);
router.patch("/:staffId/addresses/:id", auth, ownerAdmin, staff_validator_1.validateUpdateStaffAddress, staff_controller_1.staffAddressController.update);
router.delete("/:staffId/addresses/:id", auth, ownerAdmin, staff_controller_1.staffAddressController.delete);
// ─── Emergency Contacts ───────────────────────────────────────────────────────
router.get("/:staffId/emergency-contacts", auth, ownerAdminStaff, staff_controller_1.staffEmergencyContactController.list);
router.post("/:staffId/emergency-contacts", auth, ownerAdmin, staff_validator_1.validateCreateEmergencyContact, staff_controller_1.staffEmergencyContactController.create);
router.patch("/:staffId/emergency-contacts/:id", auth, ownerAdmin, staff_validator_1.validateUpdateEmergencyContact, staff_controller_1.staffEmergencyContactController.update);
router.delete("/:staffId/emergency-contacts/:id", auth, ownerAdmin, staff_controller_1.staffEmergencyContactController.delete);
// ─── Wages ────────────────────────────────────────────────────────────────────
router.get("/:staffId/wages", auth, ownerAdmin, staff_controller_1.staffWagesController.get);
router.put("/:staffId/wages", auth, ownerAdmin, staff_validator_1.validateUpdateWageSettings, staff_controller_1.staffWagesController.upsert);
// ─── Commissions ──────────────────────────────────────────────────────────────
router.get("/:staffId/commissions", auth, ownerAdmin, staff_controller_1.staffCommissionsController.list);
router.put("/:staffId/commissions", auth, ownerAdmin, staff_validator_1.validateUpdateCommission, staff_controller_1.staffCommissionsController.upsert);
// ─── Pay Runs ─────────────────────────────────────────────────────────────────
router.get("/:staffId/pay-runs", auth, ownerAdmin, staff_controller_1.staffPayRunsController.get);
router.put("/:staffId/pay-runs", auth, ownerAdmin, staff_validator_1.validateUpdatePayRun, staff_controller_1.staffPayRunsController.upsert);
// ─── Schedules ────────────────────────────────────────────────────────────────
router.get("/:staffId/scheduled", auth, ownerAdminStaff, staff_controller_1.staffSchedulesController.list);
router.put("/:staffId/scheduled", auth, ownerAdmin, staff_validator_1.validateUpsertStaffSchedules, staff_controller_1.staffSchedulesController.upsert);
// ─── Leaves ───────────────────────────────────────────────────────────────────
router.get("/:staffId/leaves", auth, ownerAdminStaff, staff_controller_1.staffLeavesController.list);
router.post("/:staffId/leaves", auth, ownerAdmin, staff_validator_1.validateCreateStaffLeave, staff_controller_1.staffLeavesController.create);
router.patch("/:staffId/leaves/:id", auth, ownerAdmin, staff_validator_1.validateUpdateStaffLeave, staff_controller_1.staffLeavesController.update);
router.delete("/:staffId/leaves/:id", auth, ownerAdmin, staff_controller_1.staffLeavesController.delete);
exports.default = router;
//# sourceMappingURL=staff.routes.js.map