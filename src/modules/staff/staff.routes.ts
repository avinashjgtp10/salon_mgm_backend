import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import {
    staffController, staffInvitationController, staffAddressController,
    staffEmergencyContactController, staffWagesController, staffCommissionsController,
    staffPayRunsController, staffSchedulesController, staffLeavesController,
} from "./staff.controller";
import {
    validateCreateStaff, validateUpdateStaff,
    validateCreateStaffAddress, validateUpdateStaffAddress,
    validateCreateEmergencyContact, validateUpdateEmergencyContact,
    validateUpdateWageSettings, validateUpdateCommission, validateUpdatePayRun,
    validateUpsertStaffSchedules, validateCreateStaffLeave, validateUpdateStaffLeave,
    validateAcceptInvitation,
} from "./staff.validator";

const router = Router();
const auth = authMiddleware;
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

// ─── Public (no auth) ─────────────────────────────────────────────────────────
router.get("/invite/:token/verify", staffInvitationController.verifyToken);
router.post("/invite/accept", validateAcceptInvitation, staffInvitationController.acceptInvitation);

// ─── Staff CRUD ───────────────────────────────────────────────────────────────
router.get("/", auth, ownerAdminStaff, staffController.list);
router.post("/", auth, ownerAdmin, validateCreateStaff, staffController.create);

// ─── Export (must be BEFORE /:id to avoid wildcard collision) ─────────────────
router.get("/export/excel", auth, ownerAdmin, staffController.exportExcel);
router.get("/export/csv", auth, ownerAdmin, staffController.exportCsv);

router.get("/:id", auth, ownerAdminStaff, staffController.getById);
router.patch("/:id", auth, ownerAdmin, validateUpdateStaff, staffController.update);
router.delete("/:id", auth, ownerAdmin, staffController.deactivate);

// ─── Invitation management ────────────────────────────────────────────────────
router.get("/:id/invitation-status", auth, ownerAdmin, staffInvitationController.getInvitationStatus);
router.post("/:id/resend-invite", auth, ownerAdmin, staffInvitationController.resendInvitation);
router.delete("/:id/cancel-invite", auth, ownerAdmin, staffInvitationController.cancelInvitation);

// ─── Addresses ────────────────────────────────────────────────────────────────
router.get("/:staffId/addresses", auth, ownerAdminStaff, staffAddressController.list);
router.post("/:staffId/addresses", auth, ownerAdmin, validateCreateStaffAddress, staffAddressController.create);
router.patch("/:staffId/addresses/:id", auth, ownerAdmin, validateUpdateStaffAddress, staffAddressController.update);
router.delete("/:staffId/addresses/:id", auth, ownerAdmin, staffAddressController.delete);

// ─── Emergency Contacts ───────────────────────────────────────────────────────
router.get("/:staffId/emergency-contacts", auth, ownerAdminStaff, staffEmergencyContactController.list);
router.post("/:staffId/emergency-contacts", auth, ownerAdmin, validateCreateEmergencyContact, staffEmergencyContactController.create);
router.patch("/:staffId/emergency-contacts/:id", auth, ownerAdmin, validateUpdateEmergencyContact, staffEmergencyContactController.update);
router.delete("/:staffId/emergency-contacts/:id", auth, ownerAdmin, staffEmergencyContactController.delete);

// ─── Wages ────────────────────────────────────────────────────────────────────
router.get("/:staffId/wages", auth, ownerAdmin, staffWagesController.get);
router.put("/:staffId/wages", auth, ownerAdmin, validateUpdateWageSettings, staffWagesController.upsert);

// ─── Commissions ──────────────────────────────────────────────────────────────
router.get("/:staffId/commissions", auth, ownerAdmin, staffCommissionsController.list);
router.put("/:staffId/commissions", auth, ownerAdmin, validateUpdateCommission, staffCommissionsController.upsert);

// ─── Pay Runs ─────────────────────────────────────────────────────────────────
router.get("/:staffId/pay-runs", auth, ownerAdmin, staffPayRunsController.get);
router.put("/:staffId/pay-runs", auth, ownerAdmin, validateUpdatePayRun, staffPayRunsController.upsert);

// ─── Schedules ────────────────────────────────────────────────────────────────
router.get("/:staffId/scheduled", auth, ownerAdminStaff, staffSchedulesController.list);
router.put("/:staffId/scheduled", auth, ownerAdmin, validateUpsertStaffSchedules, staffSchedulesController.upsert);

// ─── Leaves ───────────────────────────────────────────────────────────────────
router.get("/:staffId/leaves", auth, ownerAdminStaff, staffLeavesController.list);
router.post("/:staffId/leaves", auth, ownerAdmin, validateCreateStaffLeave, staffLeavesController.create);
router.patch("/:staffId/leaves/:id", auth, ownerAdmin, validateUpdateStaffLeave, staffLeavesController.update);
router.delete("/:staffId/leaves/:id", auth, ownerAdmin, staffLeavesController.delete);

export default router;
