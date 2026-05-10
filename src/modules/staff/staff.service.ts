import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { emailService } from "../utils/email.service";
import {
    staffRepository, staffAddressRepository,
    staffEmergencyContactRepository, staffLeavesRepository,
} from "./staff.repository";
import {
    staffWagesRepository, staffCommissionsRepository,
    staffPayRunsRepository, staffSchedulesRepository,
} from "./staffSettings.repository";

import { authRepository } from "../auth/auth.repository";
import bcrypt from "bcrypt";
import { staffInvitationRepository } from "./staffInvitation.repository";
import { salonsRepository } from "../salons/salons.repository";
import { authService } from "../auth/auth.service";
import {
    Staff, StaffAddress, StaffEmergencyContact, StaffLeave, StaffSchedule,
    StaffWageSettings, StaffCommissionSettings, StaffPayRunSettings,
    CreateStaffBody, UpdateStaffBody, CreateStaffAddressBody, UpdateStaffAddressBody,
    CreateEmergencyContactBody, UpdateEmergencyContactBody, CreateStaffLeaveBody,
    UpdateStaffLeaveBody, UpdateWageSettingsBody, UpdateCommissionBody, UpdatePayRunBody,
    UpsertStaffSchedulesBody, AcceptInvitationBody, StaffListQuery,
} from "./staff.types";

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staffService = {
    async list(salonId: string, query: StaffListQuery) {
        logger.info("staffService.list", { salonId });
        return staffRepository.list(salonId, query);
    },

    async exportStaff(salonId: string, query: Omit<StaffListQuery, "page" | "limit">) {
        logger.info("staffService.exportStaff", { salonId });
        return staffRepository.exportForDownload(salonId, query);
    },

    async getById(id: string, salonId: string): Promise<Staff> {
        const staff = await staffRepository.findById(id, salonId);
        if (!staff) throw new AppError(404, "Staff not found", "NOT_FOUND");
        return staff;
    },

    async create(params: {
        salonId: string; requesterUserId: string; requesterRole?: string; body: CreateStaffBody;
    }): Promise<{ staffId: string }> {
        const { salonId, requesterUserId, requesterRole, body } = params;
        console.log("[DEBUG] staffService.create - params:", { salonId, requesterUserId, requesterRole, email: body.email });

        try {
            console.log("[DEBUG] staffService.create - Step 1: Checking existing email...");
            const existing = await staffRepository.findByEmail(salonId, body.email);
            if (existing) {
                console.log("[DEBUG] staffService.create - Email already exists:", body.email);
                throw new AppError(409, "A staff member with this email already exists", "DUPLICATE_EMAIL");
            }

            console.log("[DEBUG] staffService.create - Step 2: Creating staff in DB...");
            const staff = await staffRepository.create(salonId, body);
            if (!staff) {
                console.error("[DEBUG] staffService.create - DB returned null staff object");
                throw new AppError(500, "Database failed to create staff record", "DB_ERROR");
            }
            console.log("[DEBUG] staffService.create - staff created with ID:", staff.id);

            console.log("[DEBUG] staffService.create - Step 3: Creating invitation...");
            const invitation = await staffInvitationRepository.create(staff.id, staff.email);
            console.log("[DEBUG] staffService.create - invitation created:", invitation?.id);

            // Send invitation email (fire-and-forget)
            console.log("[DEBUG] staffService.create - Step 4: Resolving salon name...");
            const salon = await salonsRepository.findById(salonId);
            const salonName = salon?.business_name ?? "Our Salon";

            console.log("[DEBUG] staffService.create - Step 5: Sending invitation email...");
            emailService.sendStaffInvitation({
                to: staff.email,
                token: invitation.token,
                staffFirstName: body.first_name,
                salonName,
            }).then(() => {
                console.log("[DEBUG] staffService.create - invitation email sent successfully");
            }).catch((err) => {
                console.error("[DEBUG] staffService.create - invitation email failed:", err);
            });

            return { staffId: staff.id };
        } catch (error) {
            console.error("[DEBUG] staffService.create - WORKFLOW CRASHED:", error);
            throw error;
        }
    },

    async update(params: {
        id: string; salonId: string; requesterUserId: string; requesterRole?: string; patch: UpdateStaffBody;
    }): Promise<Staff> {
        const { id, salonId, requesterUserId, requesterRole, patch } = params;
        logger.info("staffService.update", { id, salonId, requesterUserId, requesterRole });

        const existing = await staffRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");

        const updated = await staffRepository.update(id, salonId, patch);
        logger.info("staffService.update success", { staffId: updated.id });
        return updated;
    },

    async deactivate(params: {
        id: string; salonId: string; requesterUserId: string; requesterRole?: string;
    }): Promise<void> {
        const { id, salonId } = params;
        logger.info("staffService.deactivate", { id, salonId });

        const existing = await staffRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");

        await staffRepository.deactivate(id, salonId);
        logger.info("staffService.deactivate success", { staffId: id });
    },

    async delete(params: {
        id: string; salonId: string; requesterUserId: string; requesterRole?: string;
    }): Promise<void> {
        const { id, salonId } = params;
        logger.info("staffService.delete", { id, salonId });

        const existing = await staffRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");

        const deleted = await staffRepository.delete(id, salonId);
        if (!deleted) throw new AppError(500, "Failed to delete staff member", "DELETE_FAILED");
        logger.info("staffService.delete success", { staffId: id });
    },
};

// ─── Invitations ──────────────────────────────────────────────────────────────

export const staffInvitationService = {
    async verifyToken(token: string) {
        const invitation = await staffInvitationRepository.findByToken(token);
        if (!invitation) return { valid: false, expired: false };

        const isExpired = invitation.status === "expired" || new Date(invitation.expires_at) < new Date();
        if (isExpired && invitation.status === "pending") {
            await staffInvitationRepository.markExpired(invitation.staff_id);
        }

        return {
            valid: invitation.status === "pending" && !isExpired,
            email: invitation.email,
            expired: isExpired,
            status: invitation.status,
        };
    },

    async acceptInvitation(body: AcceptInvitationBody): Promise<{ staffId: string; accessToken: string; refreshToken: string; user: any; isOnboardingComplete: boolean }> {
        try {
            logger.info("acceptInvitation: start", { token: body.token });
            const invitation = await staffInvitationRepository.findByToken(body.token);

            if (!invitation) {
                logger.warn("acceptInvitation: invalid token", { token: body.token });
                throw new AppError(400, "Invalid token", "BAD_REQUEST");
            }

            if (invitation.status === "accepted") {
                logger.info("acceptInvitation: invitation already accepted", { staffId: invitation.staff_id });
                throw new AppError(400, "This invitation has already been accepted", "ALREADY_ACCEPTED");
            }

            if (new Date(invitation.expires_at) < new Date()) {
                logger.warn("acceptInvitation: expired token", { token: body.token, expiresAt: invitation.expires_at });
                throw new AppError(400, "Expired token", "BAD_REQUEST");
            }

            // Avoid creating duplicate users: check if user exists
            let user = await authRepository.findUserByEmail(invitation.email);
            const userAlreadyExisted = !!user;

            if (!user) {
                logger.info("acceptInvitation: creating new user", { email: invitation.email });
                const passwordHash = await bcrypt.hash(body.password, 10);
                user = await authRepository.createUser({
                    email: invitation.email,
                    first_name: body.first_name,
                    last_name: body.last_name,
                    password_hash: passwordHash,
                    role: 'staff',
                } as any);
            } else {
                logger.info("acceptInvitation: user already exists", { email: invitation.email, userId: user.id });
            }

            logger.info("acceptInvitation: linking user to staff", { staffId: invitation.staff_id, userId: user.id });
            await staffRepository.linkUserToStaff(
                invitation.staff_id,
                user.id,
                body.first_name,
                body.last_name
            );

            logger.info("acceptInvitation: marking user verified", { userId: user.id });
            await authRepository.markUserVerified(user.id);

            logger.info("acceptInvitation: marking invitation accepted", { token: body.token });
            await staffInvitationRepository.markAccepted(body.token);

            logger.info("acceptInvitation: attempting auto-login", { email: invitation.email });
            try {
                const loginData = await authService.login({
                    email: invitation.email,
                    password: body.password
                });

                logger.info("acceptInvitation success with auto-login", { staffId: invitation.staff_id });
                return {
                    staffId: invitation.staff_id,
                    accessToken: loginData.accessToken,
                    refreshToken: loginData.refreshToken,
                    user: loginData.user,
                    isOnboardingComplete: loginData.isOnboardingComplete
                };
            } catch (loginError: any) {
                logger.warn("acceptInvitation: auto-login failed", {
                    email: invitation.email,
                    error: loginError.message,
                    userAlreadyExisted
                });

                // If the user already existed, they might have a different password.
                // We shouldn't fail the whole invitation acceptance just because auto-login failed.
                // However, the frontend expects tokens. We'll throw a clear error message.
                if (userAlreadyExisted) {
                    throw new AppError(401, "Invitation accepted! Please log in with your existing account password.", "LOGIN_REQUIRED");
                }
                throw loginError;
            }
        } catch (error) {
            logger.error("acceptInvitation failed", { error, stack: (error as Error).stack });
            throw error;
        }
    },

    async resendInvitation(params: { staffId: string; salonId: string; salonName?: string }): Promise<void> {
        const { staffId, salonId, salonName } = params;
        const staff = await staffRepository.findById(staffId, salonId);

        if (!staff || !staff.email || staff.invitation_status === "accepted") {
            throw new AppError(400, "Cannot resend: not found, no email, or already accepted", "BAD_REQUEST");
        }

        await staffInvitationRepository.markExpired(staffId);
        const invitation = await staffInvitationRepository.create(staffId, staff.email);

        logger.info("resendInvitation success", { staffId });

        // Send invitation email (fire-and-forget)
        const salon = await salonsRepository.findById(salonId);
        const resolvedSalonName = salonName ?? salon?.business_name ?? "Our Salon";

        emailService.sendStaffInvitation({
            to: staff.email,
            token: invitation.token,
            staffFirstName: staff.first_name ?? "Team Member",
            salonName: resolvedSalonName,
        }).catch((err) =>
            logger.warn("resendInvitation: invitation email failed", { staffId, err })
        );
    },

    async cancelInvitation(params: { staffId: string; salonId: string }): Promise<void> {
        const { staffId, salonId } = params;
        const staff = await staffRepository.findById(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff not found", "NOT_FOUND");

        await staffInvitationRepository.markCancelled(staffId);
        logger.info("cancelInvitation success", { staffId });
    },

    async getInvitationStatus(params: { staffId: string; salonId: string }) {
        const { staffId, salonId } = params;
        const staff = await staffRepository.findById(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff not found", "NOT_FOUND");

        const invitation = await staffInvitationRepository.findByStaffId(staffId);

        return {
            staff_id: staff.id,
            email: staff.email,
            invitation_status: staff.invitation_status,
            invitation_accepted_at: invitation?.accepted_at || null,
            invitation_expires_at: invitation?.expires_at || null,
            is_active: staff.is_active,
        };
    },
};

// ─── Addresses ────────────────────────────────────────────────────────────────

export const staffAddressService = {
    async list(staffId: string, salonId: string): Promise<StaffAddress[]> {
        await _ensureStaff(staffId, salonId);
        return staffAddressRepository.listByStaffId(staffId);
    },
    async create(staffId: string, salonId: string, data: CreateStaffAddressBody): Promise<StaffAddress> {
        await _ensureStaff(staffId, salonId);
        return staffAddressRepository.create(staffId, data);
    },
    async update(staffId: string, salonId: string, id: string, patch: UpdateStaffAddressBody): Promise<StaffAddress> {
        await _ensureStaff(staffId, salonId);
        const updated = await staffAddressRepository.update(id, staffId, patch);
        if (!updated) throw new AppError(404, "Address not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId: string, salonId: string, id: string): Promise<void> {
        await _ensureStaff(staffId, salonId);
        const deleted = await staffAddressRepository.delete(id, staffId);
        if (!deleted) throw new AppError(404, "Address not found", "NOT_FOUND");
    },
};

// ─── Emergency Contacts ───────────────────────────────────────────────────────

export const staffEmergencyContactService = {
    async list(staffId: string, salonId: string): Promise<StaffEmergencyContact[]> {
        await _ensureStaff(staffId, salonId);
        return staffEmergencyContactRepository.listByStaffId(staffId);
    },
    async create(staffId: string, salonId: string, data: CreateEmergencyContactBody): Promise<StaffEmergencyContact> {
        await _ensureStaff(staffId, salonId);
        return staffEmergencyContactRepository.create(staffId, data);
    },
    async update(staffId: string, salonId: string, id: string, patch: UpdateEmergencyContactBody): Promise<StaffEmergencyContact> {
        await _ensureStaff(staffId, salonId);
        const updated = await staffEmergencyContactRepository.update(id, staffId, patch);
        if (!updated) throw new AppError(404, "Emergency contact not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId: string, salonId: string, id: string): Promise<void> {
        await _ensureStaff(staffId, salonId);
        const deleted = await staffEmergencyContactRepository.delete(id, staffId);
        if (!deleted) throw new AppError(404, "Emergency contact not found", "NOT_FOUND");
    },
};

// ─── Wages ────────────────────────────────────────────────────────────────────

export const staffWagesService = {
    async get(staffId: string, salonId: string): Promise<StaffWageSettings | null> {
        await _ensureStaff(staffId, salonId);
        return staffWagesRepository.findByStaffId(staffId);
    },
    async upsert(staffId: string, salonId: string, data: UpdateWageSettingsBody): Promise<StaffWageSettings> {
        await _ensureStaff(staffId, salonId);
        return staffWagesRepository.upsert(staffId, data);
    },
};

// ─── Commissions ──────────────────────────────────────────────────────────────

export const staffCommissionsService = {
    async list(staffId: string, salonId: string): Promise<StaffCommissionSettings[]> {
        await _ensureStaff(staffId, salonId);
        return staffCommissionsRepository.listByStaffId(staffId);
    },
    async upsert(staffId: string, salonId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings> {
        await _ensureStaff(staffId, salonId);
        return staffCommissionsRepository.upsert(staffId, data);
    },
};

// ─── Pay Runs ─────────────────────────────────────────────────────────────────

export const staffPayRunsService = {
    async get(staffId: string, salonId: string): Promise<StaffPayRunSettings | null> {
        await _ensureStaff(staffId, salonId);
        return staffPayRunsRepository.findByStaffId(staffId);
    },
    async upsert(staffId: string, salonId: string, data: UpdatePayRunBody): Promise<StaffPayRunSettings> {
        await _ensureStaff(staffId, salonId);
        return staffPayRunsRepository.upsert(staffId, data);
    },
};

// ─── Schedules ────────────────────────────────────────────────────────────────

export const staffSchedulesService = {
    async list(staffId: string, salonId: string): Promise<StaffSchedule[]> {
        await _ensureStaff(staffId, salonId);
        return staffSchedulesRepository.listByStaffId(staffId);
    },
    async upsert(staffId: string, salonId: string, body: UpsertStaffSchedulesBody): Promise<StaffSchedule[]> {
        await _ensureStaff(staffId, salonId);
        return staffSchedulesRepository.upsertBulk(staffId, body);
    },
};

// ─── Leaves ───────────────────────────────────────────────────────────────────

export const staffLeavesService = {
    async list(staffId: string, salonId: string, from?: string, to?: string): Promise<StaffLeave[]> {
        await _ensureStaff(staffId, salonId);
        return staffLeavesRepository.listByStaffId(staffId, from, to);
    },
    async create(staffId: string, salonId: string, data: CreateStaffLeaveBody): Promise<StaffLeave> {
        await _ensureStaff(staffId, salonId);
        return staffLeavesRepository.create(staffId, data);
    },
    async update(staffId: string, salonId: string, id: string, patch: UpdateStaffLeaveBody): Promise<StaffLeave> {
        await _ensureStaff(staffId, salonId);
        const updated = await staffLeavesRepository.update(id, staffId, patch);
        if (!updated) throw new AppError(404, "Leave not found", "NOT_FOUND");
        return updated;
    },
    async delete(staffId: string, salonId: string, id: string): Promise<void> {
        await _ensureStaff(staffId, salonId);
        const deleted = await staffLeavesRepository.delete(id, staffId);
        if (!deleted) throw new AppError(404, "Leave not found", "NOT_FOUND");
    },
};

// ─── Internal helper ──────────────────────────────────────────────────────────

async function _ensureStaff(staffId: string, salonId: string): Promise<Staff> {
    const staff = await staffRepository.findById(staffId, salonId);
    if (!staff) throw new AppError(404, "Staff not found", "NOT_FOUND");
    return staff;
}
