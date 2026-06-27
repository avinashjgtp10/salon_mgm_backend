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
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";

import { authRepository } from "../auth/auth.repository";
import bcrypt from "bcrypt";
import { staffInvitationRepository } from "./staffInvitation.repository";
import { salonsRepository } from "../salons/salons.repository";
import { authService } from "../auth/auth.service";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import {
    Staff, StaffAddress, StaffEmergencyContact, StaffLeave, StaffSchedule,
    StaffWageSettings, StaffCommissionSettings, StaffPayRunSettings,
    CreateStaffBody, UpdateStaffBody, CreateStaffAddressBody, UpdateStaffAddressBody,
    CreateEmergencyContactBody, UpdateEmergencyContactBody, CreateStaffLeaveBody,
    UpdateStaffLeaveBody, UpdateWageSettingsBody, UpdateCommissionBody, UpdatePayRunBody,
    UpsertStaffSchedulesBody, AcceptInvitationBody, StaffListQuery, StaffImportResult,
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

            let passwordHash: string | null = null;
            if (body.password) {
                passwordHash = await bcrypt.hash(body.password, 10);
            }

            console.log("[DEBUG] staffService.create - Step 2: Creating staff in DB...");
            const staff = await staffRepository.create(salonId, body, passwordHash);
            if (!staff) {
                console.error("[DEBUG] staffService.create - DB returned null staff object");
                throw new AppError(500, "Database failed to create staff record", "DB_ERROR");
            }
            console.log("[DEBUG] staffService.create - staff created with ID:", staff.id);

            if (body.password && passwordHash) {
                console.log("[DEBUG] staffService.create - Step 3: Admin-set password, creating user account directly...");
                let user = await authRepository.findUserByEmail(body.email);
                if (!user) {
                    user = await authRepository.createUser({
                        email: body.email,
                        first_name: body.first_name,
                        last_name: body.last_name ?? null,
                        password_hash: passwordHash,
                        role: "staff",
                    } as any);
                } else {
                    await authRepository.updateUserRole(user.id, "staff");
                }
                await staffRepository.linkUserToStaff(staff.id, user.id, body.first_name, body.last_name);
                await authRepository.markUserVerified(user.id);
                await authRepository.markOnboardingComplete(user.id);
                await staffRepository.activateDirectly(staff.id);
                console.log("[DEBUG] staffService.create - user account created and staff activated:", user.id);
            } else {
                console.log("[DEBUG] staffService.create - Step 3: Creating invitation...");
                const invitation = await staffInvitationRepository.create(staff.id, staff.email);
                console.log("[DEBUG] staffService.create - invitation created:", invitation?.id);

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
            }

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

        // Split out blocked_times — handled separately, not a staff table column
        const { blocked_times: blockedTimesToCreate, ...staffPatch } = patch as any;

        // Create any embedded blocked times
        const createdBlockedTimes: any[] = [];
        if (Array.isArray(blockedTimesToCreate) && blockedTimesToCreate.length > 0) {
            for (const bt of blockedTimesToCreate) {
                const created = await blockedTimesRepository.create(
                    { salon_id: salonId, staff_id: id, date: bt.date, start_time: bt.start_time, end_time: bt.end_time, reason: bt.reason ?? null },
                    requesterUserId
                );
                createdBlockedTimes.push(created);
            }
            logger.info("staffService.update: blocked times created", { count: createdBlockedTimes.length, staffId: id });
        }

        // Only update staff columns if there is other data besides blocked_times
        let updated: Staff = existing;
        if (Object.keys(staffPatch).length > 0) {
            let passwordHash: string | null | undefined = undefined;
            if (staffPatch.password) {
                passwordHash = await bcrypt.hash(staffPatch.password, 10);
            }
            updated = await staffRepository.update(id, salonId, staffPatch, passwordHash);
        }

        // Attach newly created blocked times to the response so the frontend can replace the temp ID
        if (createdBlockedTimes.length > 0) {
            (updated as any).blocked_times = createdBlockedTimes;
        }

        logger.info("staffService.update success", { staffId: updated.id });
        return updated;
    },

    async activate(params: {
        id: string; salonId: string; requesterUserId: string; requesterRole?: string;
    }): Promise<void> {
        const { id, salonId } = params;
        logger.info("staffService.activate", { id, salonId });

        const existing = await staffRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");

        await staffRepository.activate(id, salonId);
        logger.info("staffService.activate success", { staffId: id });
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

    async importStaff(params: {
        rows: any[];
        salonId: string;
        dry_run: boolean;
    }): Promise<StaffImportResult> {
        const { rows, salonId, dry_run } = params;
        const result: StaffImportResult = {
            total_rows: rows.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
        };

        const parseDate = (val: string): string | null => {
            const s = String(val || "").trim();
            if (!s) return null;
            const parts = s.split("-");
            if (parts.length !== 3) return null;
            const [day, month, year] = parts;
            if (!day || !month || !year) return null;
            return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        };

        const parseDOB = (val: string): { birthday_day: number | null; birthday_month: number | null } => {
            const s = String(val || "").trim();
            if (!s) return { birthday_day: null, birthday_month: null };
            const parts = s.split("-");
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            return {
                birthday_day: isNaN(day) ? null : day,
                birthday_month: isNaN(month) ? null : month,
            };
        };

        const toNum = (val: any): number | null => {
            const n = parseFloat(String(val || ""));
            return isNaN(n) ? null : n;
        };

        const allEmails = rows
            .map(row => String(row["Email"] ?? row["email"] ?? "").trim().toLowerCase())
            .filter(Boolean);
        const existingMap = await staffRepository.findByEmails(salonId, allEmails);

        const BATCH_SIZE = 5;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(async (row, batchIdx) => {
                    const rowNum = i + batchIdx + 1;
                    const part = { imported: 0, updated: 0, skipped: 0, errors: [] as StaffImportResult["errors"] };
                    const email = String(row["Email"] ?? row["email"] ?? "").trim().toLowerCase();

                    try {
                        const fullName = String(row["Name"] ?? row["name"] ?? "").trim();
                        if (!fullName && !email) {
                            part.skipped += 1;
                            part.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Name and Email are both empty" });
                            return part;
                        }
                        if (!email) {
                            part.skipped += 1;
                            part.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Email is required" });
                            return part;
                        }

                        const nameParts = fullName.split(" ");
                        const first_name = nameParts[0] || email.split("@")[0];
                        const last_name = nameParts.slice(1).join(" ") || undefined;

                        const phone = String(row["Contact"] ?? row["contact"] ?? "").trim() || undefined;
                        const country = String(row["Address"] ?? row["address"] ?? "").trim() || undefined;
                        const job_title = String(row["Designation"] ?? row["designation"] ?? "").trim() || undefined;

                        const dojRaw = String(row["DOJ(dd-mm-YYYY)"] ?? row["DOJ"] ?? row["doj"] ?? "").trim();
                        const dobRaw = String(row["DOB(dd-mm-YYYY)"] ?? row["DOB"] ?? row["dob"] ?? "").trim();
                        const hourly_rate = toNum(row["Hourly Rate"] ?? row["hourly_rate"]);
                        const salary_amount = toNum(row["Fixed Salary"] ?? row["fixed_salary"]);

                        const joined_date = parseDate(dojRaw);
                        const { birthday_day, birthday_month } = parseDOB(dobRaw);

                        const existing = existingMap.get(email);

                        if (existing) {
                            if (!dry_run) {
                                await staffRepository.update(existing.id, salonId, {
                                    first_name, last_name, phone, country, job_title,
                                });
                                await staffRepository.updateDateFields(existing.id, salonId, { joined_date, birthday_day, birthday_month });
                                if (hourly_rate !== null || salary_amount !== null) {
                                    await staffWagesRepository.upsert(existing.id, {
                                        wages_enabled: true,
                                        compensation_type: hourly_rate !== null ? "hourly" : "salary",
                                        hourly_rate: hourly_rate ?? undefined,
                                        salary_amount: salary_amount ?? undefined,
                                    });
                                }
                            }
                            part.updated += 1;
                        } else {
                            if (!dry_run) {
                                const staff = await staffRepository.create(salonId, {
                                    first_name, last_name, email, phone, country, job_title,
                                }, null, true); // activateImmediately = true: imported staff don't need email invites
                                await staffRepository.updateDateFields(staff.id, salonId, { joined_date, birthday_day, birthday_month });
                                if (hourly_rate !== null || salary_amount !== null) {
                                    await staffWagesRepository.upsert(staff.id, {
                                        wages_enabled: true,
                                        compensation_type: hourly_rate !== null ? "hourly" : "salary",
                                        hourly_rate: hourly_rate ?? undefined,
                                        salary_amount: salary_amount ?? undefined,
                                    });
                                }
                            }
                            part.imported += 1;
                        }
                    } catch (e: any) {
                        part.errors.push({ row: rowNum, email, code: "IMPORT_ERROR", message: e?.message || "Unknown error" });
                    }

                    return part;
                })
            );

            for (const part of batchResults) {
                result.imported += part.imported;
                result.updated += part.updated;
                result.skipped += part.skipped;
                result.errors.push(...part.errors);
            }
        }

        return result;
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
                logger.info("acceptInvitation: user already exists — updating role to staff", { email: invitation.email, userId: user.id });
                await authRepository.updateUserRole(user.id, 'staff');
                user = { ...user, role: 'staff' };
            }

            logger.info("acceptInvitation: linking user to staff", { staffId: invitation.staff_id, userId: user.id });
            await staffRepository.linkUserToStaff(invitation.staff_id, user.id, body.first_name, body.last_name);

            logger.info("acceptInvitation: marking user verified", { userId: user.id });
            await authRepository.markUserVerified(user.id);

            logger.info("acceptInvitation: marking invitation accepted", { token: body.token });
            await staffInvitationRepository.markAccepted(body.token);

            logger.info("acceptInvitation: attempting auto-login", { email: invitation.email });
            try {
                const loginData = await authService.login({ email: invitation.email, password: body.password });
                logger.info("acceptInvitation success with auto-login", { staffId: invitation.staff_id });
                return {
                    staffId: invitation.staff_id,
                    accessToken: loginData.accessToken,
                    refreshToken: loginData.refreshToken,
                    user: loginData.user,
                    isOnboardingComplete: loginData.isOnboardingComplete,
                };
            } catch (loginError: any) {
                logger.warn("acceptInvitation: auto-login failed", { email: invitation.email, error: loginError.message, userAlreadyExisted });
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

        const salon = await salonsRepository.findById(salonId);
        const resolvedSalonName = salonName ?? salon?.business_name ?? "Our Salon";

        emailService.sendStaffInvitation({
            to: staff.email,
            token: invitation.token,
            staffFirstName: staff.first_name ?? "Team Member",
            salonName: resolvedSalonName,
        }).catch((err) => logger.warn("resendInvitation: invitation email failed", { staffId, err }));
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
    // ── Summary: total earned, paid, pending for the whole salon ─────────────
    async getSalonSummary(salonId: string, month?: string) {
        return commissionCalculationService.getSalonSummary(salonId, month);
    },

    // ── Earned commissions grouped by staff ───────────────────────────────────
    async getEarnedBySalon(salonId: string, month?: string) {
        return commissionCalculationService.getEarnedBySalon(salonId, month);
    },

    // ── Mark all pending commissions as paid for a staff member ───────────────
    async markStaffCommissionPaid(salonId: string, staffId: string) {
        return commissionCalculationService.markStaffPaid(salonId, staffId);
    },

    async upsertSlabs(staffId: string, salonId: string, category: string, slabs: any[]) {
        return commissionCalculationService.upsertSlabs(staffId, salonId, category, slabs);
    },

    async getSlabs(staffId: string, category?: string) {
        return commissionCalculationService.getSlabs(staffId, category);
    },

    async getStaffHistory(staffId: string, month?: string) {
        return commissionCalculationService.getStaffHistory(staffId, month);
    },

    async exportCommissions(salonId: string, month?: string) {
        return commissionCalculationService.exportBySalon(salonId, month);
    },
    async list(staffId: string, salonId: string): Promise<StaffCommissionSettings[]> {
        await _ensureStaff(staffId, salonId);
        return staffCommissionsRepository.listByStaffId(staffId);
    },

    // ── NEW: single query for all staff commissions in a salon ────────────────
    async listBySalon(salonId: string) {
        return staffCommissionsRepository.listBySalonId(salonId);
    },

    async upsert(staffId: string, salonId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings> {
        await _ensureStaff(staffId, salonId);
        return staffCommissionsRepository.upsert(staffId, data);
    },

    async bulkConfigure(
        salonId: string,
        staffIds: string[],
        data: UpdateCommissionBody,
        slabs: { revenue_target: number; commission_kind: string; commission_value: number }[]
    ) {
        return staffCommissionsRepository.bulkUpsert(salonId, staffIds, data, slabs);
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
    async deleteByDate(staffId: string, salonId: string, date: string): Promise<void> {
        await _ensureStaff(staffId, salonId);
        await staffSchedulesRepository.deleteByDate(staffId, date);
    },
    async delete(staffId: string, salonId: string, dateStr: string): Promise<void> {
        await _ensureStaff(staffId, salonId);
        const dateObj = new Date(dateStr + "T12:00:00");
        const dayOfWeek = dateObj.getDay();
        await staffSchedulesRepository.deleteByDay(staffId, dayOfWeek);
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