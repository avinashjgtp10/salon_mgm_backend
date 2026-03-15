"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffLeavesService = exports.staffSchedulesService = exports.staffPayRunsService = exports.staffCommissionsService = exports.staffWagesService = exports.staffEmergencyContactService = exports.staffAddressService = exports.staffInvitationService = exports.staffService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const email_service_1 = require("../utils/email.service");
const staff_repository_1 = require("./staff.repository");
const staffSettings_repository_1 = require("./staffSettings.repository");
const staffInvitation_repository_1 = require("./staffInvitation.repository");
const salons_repository_1 = require("../salons/salons.repository");
// ─── Staff ────────────────────────────────────────────────────────────────────
exports.staffService = {
    async list(salonId, query) {
        logger_1.default.info("staffService.list", { salonId });
        return staff_repository_1.staffRepository.list(salonId, query);
    },
    async exportStaff(salonId, query) {
        logger_1.default.info("staffService.exportStaff", { salonId });
        return staff_repository_1.staffRepository.exportForDownload(salonId, query);
    },
    async getById(id, salonId) {
        const staff = await staff_repository_1.staffRepository.findById(id, salonId);
        if (!staff)
            throw new error_middleware_1.AppError(404, "Staff not found", "NOT_FOUND");
        return staff;
    },
    async create(params) {
        const { salonId, requesterUserId, requesterRole, body } = params;
        logger_1.default.info("staffService.create", { salonId, requesterUserId, requesterRole, email: body.email });
        const staff = await staff_repository_1.staffRepository.create(salonId, body);
        const invitation = await staffInvitation_repository_1.staffInvitationRepository.create(staff.id, staff.email);
        logger_1.default.info("staffService.create success", { staffId: staff.id });
        // Send invitation email (fire-and-forget: don't fail the creation if email fails)
        const salon = await salons_repository_1.salonsRepository.findById(salonId);
        const salonName = salon?.business_name ?? "Our Salon";
        email_service_1.emailService.sendStaffInvitation({
            to: staff.email,
            token: invitation.token,
            staffFirstName: body.first_name,
            salonName,
        }).catch((err) => logger_1.default.warn("staffService.create: invitation email failed", { staffId: staff.id, err }));
        return { staffId: staff.id };
    },
    async update(params) {
        const { id, salonId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("staffService.update", { id, salonId, requesterUserId, requesterRole });
        const existing = await staff_repository_1.staffRepository.findById(id, salonId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Staff not found", "NOT_FOUND");
        const updated = await staff_repository_1.staffRepository.update(id, salonId, patch);
        logger_1.default.info("staffService.update success", { staffId: updated.id });
        return updated;
    },
    async deactivate(params) {
        const { id, salonId } = params;
        logger_1.default.info("staffService.deactivate", { id, salonId });
        const existing = await staff_repository_1.staffRepository.findById(id, salonId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Staff not found", "NOT_FOUND");
        await staff_repository_1.staffRepository.deactivate(id, salonId);
        logger_1.default.info("staffService.deactivate success", { staffId: id });
    },
};
// ─── Invitations ──────────────────────────────────────────────────────────────
exports.staffInvitationService = {
    async verifyToken(token) {
        const invitation = await staffInvitation_repository_1.staffInvitationRepository.findByToken(token);
        if (!invitation)
            return { valid: false, expired: false };
        const isExpired = invitation.status === "expired" || new Date(invitation.expires_at) < new Date();
        if (isExpired && invitation.status === "pending") {
            await staffInvitation_repository_1.staffInvitationRepository.markExpired(invitation.staff_id);
        }
        return {
            valid: invitation.status === "pending" && !isExpired,
            email: invitation.email,
            expired: isExpired,
        };
    },
    async acceptInvitation(body) {
        const invitation = await staffInvitation_repository_1.staffInvitationRepository.findByToken(body.token);
        if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
            throw new error_middleware_1.AppError(400, "Invalid, expired or already used token", "BAD_REQUEST");
        }
        // TODO: hash password + create/link user account
        // e.g. const user = await authService.createUser({ email: invitation.email, password: body.password, ... });
        // await staffRepository.update(invitation.staff_id, ..., { user_id: user.id, first_name: body.first_name });
        await staffInvitation_repository_1.staffInvitationRepository.markAccepted(body.token);
        logger_1.default.info("acceptInvitation success", { staffId: invitation.staff_id });
        return { staffId: invitation.staff_id };
    },
    async resendInvitation(params) {
        const { staffId, salonId, salonName } = params;
        const staff = await staff_repository_1.staffRepository.findById(staffId, salonId);
        if (!staff || !staff.email || staff.invitation_status === "accepted") {
            throw new error_middleware_1.AppError(400, "Cannot resend: not found, no email, or already accepted", "BAD_REQUEST");
        }
        await staffInvitation_repository_1.staffInvitationRepository.markExpired(staffId);
        const invitation = await staffInvitation_repository_1.staffInvitationRepository.create(staffId, staff.email);
        logger_1.default.info("resendInvitation success", { staffId });
        // Send invitation email (fire-and-forget)
        const salon = await salons_repository_1.salonsRepository.findById(salonId);
        const resolvedSalonName = salonName ?? salon?.business_name ?? "Our Salon";
        email_service_1.emailService.sendStaffInvitation({
            to: staff.email,
            token: invitation.token,
            staffFirstName: staff.first_name ?? "Team Member",
            salonName: resolvedSalonName,
        }).catch((err) => logger_1.default.warn("resendInvitation: invitation email failed", { staffId, err }));
    },
    async cancelInvitation(params) {
        const { staffId, salonId } = params;
        const staff = await staff_repository_1.staffRepository.findById(staffId, salonId);
        if (!staff)
            throw new error_middleware_1.AppError(404, "Staff not found", "NOT_FOUND");
        await staffInvitation_repository_1.staffInvitationRepository.markCancelled(staffId);
        logger_1.default.info("cancelInvitation success", { staffId });
    },
};
// ─── Addresses ────────────────────────────────────────────────────────────────
exports.staffAddressService = {
    async list(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffAddressRepository.listByStaffId(staffId);
    },
    async create(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffAddressRepository.create(staffId, data);
    },
    async update(staffId, salonId, id, patch) {
        await _ensureStaff(staffId, salonId);
        const updated = await staff_repository_1.staffAddressRepository.update(id, staffId, patch);
        if (!updated)
            throw new error_middleware_1.AppError(404, "Address not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId, salonId, id) {
        await _ensureStaff(staffId, salonId);
        const deleted = await staff_repository_1.staffAddressRepository.delete(id, staffId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, "Address not found", "NOT_FOUND");
    },
};
// ─── Emergency Contacts ───────────────────────────────────────────────────────
exports.staffEmergencyContactService = {
    async list(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffEmergencyContactRepository.listByStaffId(staffId);
    },
    async create(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffEmergencyContactRepository.create(staffId, data);
    },
    async update(staffId, salonId, id, patch) {
        await _ensureStaff(staffId, salonId);
        const updated = await staff_repository_1.staffEmergencyContactRepository.update(id, staffId, patch);
        if (!updated)
            throw new error_middleware_1.AppError(404, "Emergency contact not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId, salonId, id) {
        await _ensureStaff(staffId, salonId);
        const deleted = await staff_repository_1.staffEmergencyContactRepository.delete(id, staffId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, "Emergency contact not found", "NOT_FOUND");
    },
};
// ─── Wages ────────────────────────────────────────────────────────────────────
exports.staffWagesService = {
    async get(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffWagesRepository.findByStaffId(staffId);
    },
    async upsert(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffWagesRepository.upsert(staffId, data);
    },
};
// ─── Commissions ──────────────────────────────────────────────────────────────
exports.staffCommissionsService = {
    async list(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffCommissionsRepository.listByStaffId(staffId);
    },
    async upsert(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffCommissionsRepository.upsert(staffId, data);
    },
};
// ─── Pay Runs ─────────────────────────────────────────────────────────────────
exports.staffPayRunsService = {
    async get(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffPayRunsRepository.findByStaffId(staffId);
    },
    async upsert(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffPayRunsRepository.upsert(staffId, data);
    },
};
// ─── Schedules ────────────────────────────────────────────────────────────────
exports.staffSchedulesService = {
    async list(staffId, salonId) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffSchedulesRepository.listByStaffId(staffId);
    },
    async upsert(staffId, salonId, body) {
        await _ensureStaff(staffId, salonId);
        return staffSettings_repository_1.staffSchedulesRepository.upsertBulk(staffId, body);
    },
};
// ─── Leaves ───────────────────────────────────────────────────────────────────
exports.staffLeavesService = {
    async list(staffId, salonId, from, to) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffLeavesRepository.listByStaffId(staffId, from, to);
    },
    async create(staffId, salonId, data) {
        await _ensureStaff(staffId, salonId);
        return staff_repository_1.staffLeavesRepository.create(staffId, data);
    },
    async update(staffId, salonId, id, patch) {
        await _ensureStaff(staffId, salonId);
        const updated = await staff_repository_1.staffLeavesRepository.update(id, staffId, patch);
        if (!updated)
            throw new error_middleware_1.AppError(404, "Leave not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId, salonId, id) {
        await _ensureStaff(staffId, salonId);
        const deleted = await staff_repository_1.staffLeavesRepository.delete(id, staffId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, "Leave not found", "NOT_FOUND");
    },
};
// ─── Internal helper ──────────────────────────────────────────────────────────
async function _ensureStaff(staffId, salonId) {
    const staff = await staff_repository_1.staffRepository.findById(staffId, salonId);
    if (!staff)
        throw new error_middleware_1.AppError(404, "Staff not found", "NOT_FOUND");
    return staff;
}
//# sourceMappingURL=staff.service.js.map