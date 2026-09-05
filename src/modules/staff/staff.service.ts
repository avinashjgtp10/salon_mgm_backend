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
import { randomUUID } from "crypto";
import { staffInvitationRepository } from "./staffInvitation.repository";
import { salonsRepository } from "../salons/salons.repository";
import { authService } from "../auth/auth.service";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { tipCalculationService } from "../tips/tipCalculation.service";
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

            // Guard against silently hijacking a salon_owner/admin/super_admin account:
            // without this check, the "admin sets password directly" branch below
            // would find that user by email and overwrite their role to "staff" via
            // updateUserRole() — and even before that, staffRepository.create() just
            // below unconditionally inserts a `staff` row for this email regardless
            // of what role its linked user account actually holds, so a superadmin
            // (or owner/admin) email could end up listed as an active staff member
            // in the UI even though the users.role mutation itself gets blocked
            // downstream (see authRepository's reserved-email guard). super_admin
            // was missing from this check entirely — that's exactly what let
            // avinash@salonox.com (a real superadmin login) get added as staff.
            //
            // super_admin gets the same plain "already exists" wording as a normal
            // duplicate-email collision (DUPLICATE_EMAIL above) rather than naming
            // the role — a staff-creation form has no business surfacing that an
            // email belongs to a platform superadmin account.
            const existingUser = await authRepository.findUserByEmail(body.email);
            if (existingUser?.role === "super_admin") {
                console.log("[DEBUG] staffService.create - Email belongs to an existing super_admin:", body.email);
                throw new AppError(409, "A staff member with this email already exists", "DUPLICATE_EMAIL");
            }
            if (existingUser && (existingUser.role === "salon_owner" || existingUser.role === "admin")) {
                console.log("[DEBUG] staffService.create - Email belongs to an existing", existingUser.role, ":", body.email);
                throw new AppError(
                    409,
                    `This email already exists as the ${existingUser.role === "salon_owner" ? "salon owner" : "admin"} and cannot be added as a staff member.`,
                    "EMAIL_IS_OWNER_OR_ADMIN",
                );
            }

            let passwordHash: string | null = null;
            if (body.password) {
                passwordHash = await bcrypt.hash(body.password, 10);
            }

            console.log("[DEBUG] staffService.create - Step 2: Creating staff in DB...");
            // Admin-set password activates immediately regardless of email verification
            // (the password path bypasses invitation/OTP entirely). Otherwise, activation
            // follows whether the frontend confirmed the staff member's email OTP.
            const activateImmediately = body.password ? true : body.email_verified === true;
            const staff = await staffRepository.create(salonId, body, passwordHash, activateImmediately);
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
                console.log("[DEBUG] staffService.create - Step 3: Linking a user account up front...");
                // staff.user_id is populated immediately, even before the invite is
                // accepted — otherwise anything keyed on user_id (e.g. the audit
                // auditor picker) sits empty for any staff who hasn't opened their
                // invite email yet, which may be never (e.g. QA, where invite
                // emails often go nowhere). If `existingUser` (looked up above) is
                // a real account, we just link it. Otherwise the new account is
                // inert until acceptInvitation sets a real password: unverified,
                // no onboarding, and a random bcrypt hash nobody knows.
                let inviteUser = existingUser;
                if (!inviteUser) {
                    const placeholderHash = await bcrypt.hash(randomUUID(), 10);
                    inviteUser = await authRepository.createUser({
                        email: staff.email,
                        first_name: body.first_name,
                        last_name: body.last_name ?? null,
                        password_hash: placeholderHash,
                        role: "staff",
                    } as any);
                }
                await staffRepository.linkUserToStaff(staff.id, inviteUser.id, body.first_name, body.last_name);

                console.log("[DEBUG] staffService.create - Step 4: Creating invitation...");
                const invitation = await staffInvitationRepository.create(staff.id, staff.email);
                console.log("[DEBUG] staffService.create - invitation created:", invitation?.id);

                console.log("[DEBUG] staffService.create - Step 5: Resolving salon name...");
                const salon = await salonsRepository.findById(salonId);
                const salonName = salon?.business_name ?? "Our Salon";

                console.log("[DEBUG] staffService.create - Step 6: Sending invitation email...");
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

            // A password was just set for this staff member — make sure a login-
            // capable `users` row actually exists and is linked. Without this,
            // `staff.password_hash` is written but login (which looks up `users`
            // by email) still fails with "Invalid credentials", because staff
            // created via the invite flow never got a `users` row in the first
            // place (see staffService.create's equivalent branch).
            if (staffPatch.password && passwordHash) {
                const email = staffPatch.email ?? existing.email;
                if (existing.user_id) {
                    await authRepository.updatePassword(existing.user_id, passwordHash);
                } else {
                    let user = await authRepository.findUserByEmail(email);
                    if (!user) {
                        user = await authRepository.createUser({
                            email,
                            first_name: staffPatch.first_name ?? existing.first_name ?? "",
                            last_name: staffPatch.last_name ?? existing.last_name ?? null,
                            password_hash: passwordHash,
                            role: "staff",
                        } as any);
                    } else {
                        await authRepository.updateUserRole(user.id, "staff");
                        await authRepository.updatePassword(user.id, passwordHash);
                    }
                    await staffRepository.linkUserToStaff(
                        id, user.id,
                        staffPatch.first_name ?? existing.first_name ?? "",
                        staffPatch.last_name ?? existing.last_name ?? undefined,
                    );
                    await authRepository.markUserVerified(user.id);
                    await authRepository.markOnboardingComplete(user.id);
                    await staffRepository.activateDirectly(id);
                }
                updated = (await staffRepository.findById(id, salonId)) ?? updated;
            }
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

        // ── Required-column check ───────────────────────────────────────────────
        // Run before touching any row — a row-by-row scan on a file that's
        // missing a whole column just spams "field is required" once per row
        // instead of naming the real problem.
        const REQUIRED_COLUMN_ALIASES: Record<string, string[]> = {
            Name: ["Name", "name"],
            Contact: ["Contact", "contact"],
            Email: ["Email", "email"],
            Gender: ["Gender", "gender"],
            "DOJ(dd-mm-YYYY)": ["DOJ(dd-mm-YYYY)", "DOJ", "doj"],
        };
        if (rows.length > 0) {
            const headers = new Set(Object.keys(rows[0]));
            const missingColumns = Object.entries(REQUIRED_COLUMN_ALIASES)
                .filter(([, aliases]) => !aliases.some((a) => headers.has(a)))
                .map(([label]) => label);
            if (missingColumns.length > 0) {
                result.skipped = result.total_rows;
                result.errors.push({
                    row: 0,
                    field: "File",
                    code: "MISSING_COLUMNS",
                    message: `Missing required column(s): ${missingColumns.join(", ")}`,
                });
                return result;
            }
        }

        const parseDate = (val: string): string | null => {
            const s = String(val || "").trim();
            if (!s) return null;
            const parts = s.split("-");
            if (parts.length !== 3) return null;
            const [day, month, year] = parts;
            if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
            const d = parseInt(day, 10), m = parseInt(month, 10), y = parseInt(year, 10);
            if (m < 1 || m > 12 || d < 1 || d > 31) return null;
            // Reject e.g. 31-04-2024 (April has 30 days) — Date rolls over
            // instead of throwing, so a round-trip check catches it.
            const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const parsed = new Date(iso + "T00:00:00");
            if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) return null;
            return iso;
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

        // Accepts an explicit "not provided" sentinel (undefined) separately
        // from "provided but not a number" (NaN) so callers can tell "optional
        // field, skip it" from "optional field, but what's there is invalid".
        const toNum = (val: any): number | undefined => {
            const s = String(val ?? "").trim();
            if (!s) return undefined;
            return parseFloat(s);
        };

        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        // Digits only (after stripping common separators), 7–15 digits — wide
        // enough to cover local and international formats without being a
        // full E.164 validator.
        const isValidPhone = (s: string) => /^\d{7,15}$/.test(s.replace(/[\s\-()+]/g, ""));
        const VALID_GENDERS = new Set(["male", "female", "other"]);

        // "Role" in the import file mirrors the Create Staff form's Role
        // picker (Staff/Manager), which is really a shorthand for
        // permission_level — not a full custom role. Empty defaults to
        // Staff (permission_level "low", the same default staffRepository.create
        // already applies); anything else must match one of the two options.
        const ROLE_TO_PERMISSION_LEVEL: Record<string, string> = { staff: "low", manager: "manager" };

        const allEmails = rows
            .map(row => String(row["Email"] ?? row["email"] ?? "").trim().toLowerCase())
            .filter(Boolean);
        const existingMap = await staffRepository.findByEmails(salonId, allEmails);
        // Tracks emails already consumed by an earlier row in *this* file —
        // two rows importing the same new staff member is a duplicate, not
        // two separate creates.
        const seenEmails = new Map<string, number>();

        const BATCH_SIZE = 5;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(async (row, batchIdx) => {
                    const rowNum = i + batchIdx + 1;
                    const part = { imported: 0, updated: 0, skipped: 0, errors: [] as StaffImportResult["errors"] };
                    const email = String(row["Email"] ?? row["email"] ?? "").trim().toLowerCase();
                    const fieldErrors: { field: string; message: string }[] = [];

                    try {
                        const fullName = String(row["Name"] ?? row["name"] ?? "").trim();
                        const phoneRaw = String(row["Contact"] ?? row["contact"] ?? "").trim();
                        const genderRaw = String(row["Gender"] ?? row["gender"] ?? "").trim();
                        const dojRaw = String(row["DOJ(dd-mm-YYYY)"] ?? row["DOJ"] ?? row["doj"] ?? "").trim();
                        const dobRaw = String(row["DOB(dd-mm-YYYY)"] ?? row["DOB"] ?? row["dob"] ?? "").trim();
                        const roleRaw = String(row["Role"] ?? row["role"] ?? "").trim();

                        if (!fullName) fieldErrors.push({ field: "Name", message: "Name is required" });
                        if (!phoneRaw) fieldErrors.push({ field: "Contact", message: "Contact is required" });
                        else if (!isValidPhone(phoneRaw)) fieldErrors.push({ field: "Contact", message: "Contact number is invalid" });
                        if (!email) fieldErrors.push({ field: "Email", message: "Email is required" });
                        else if (!EMAIL_RE.test(email)) fieldErrors.push({ field: "Email", message: "Invalid email format" });
                        if (!genderRaw) fieldErrors.push({ field: "Gender", message: "Gender is required" });
                        else if (!VALID_GENDERS.has(genderRaw.toLowerCase())) fieldErrors.push({ field: "Gender", message: "Invalid Gender — must be Male, Female, or Other" });

                        let joined_date: string | null = null;
                        if (!dojRaw) fieldErrors.push({ field: "DOJ", message: "DOJ is required" });
                        else {
                            joined_date = parseDate(dojRaw);
                            if (!joined_date) fieldErrors.push({ field: "DOJ", message: "Invalid date format. Expected dd-mm-YYYY" });
                        }

                        if (dobRaw && !parseDate(dobRaw)) {
                            fieldErrors.push({ field: "DOB", message: "Invalid date format. Expected dd-mm-YYYY" });
                        }

                        let permission_level: string | null = "low";
                        if (roleRaw) {
                            permission_level = ROLE_TO_PERMISSION_LEVEL[roleRaw.toLowerCase()] ?? null;
                            if (!permission_level) fieldErrors.push({ field: "Role", message: "Role does not exist" });
                        }

                        const hourly_rate = toNum(row["Hourly Rate"] ?? row["hourly_rate"]);
                        if (typeof hourly_rate === "number" && (isNaN(hourly_rate) || hourly_rate < 0)) {
                            fieldErrors.push({ field: "Hourly Rate", message: "Invalid Hourly Rate" });
                        }
                        const salary_amount = toNum(row["Fixed Salary"] ?? row["fixed_salary"]);
                        if (typeof salary_amount === "number" && (isNaN(salary_amount) || salary_amount < 0)) {
                            fieldErrors.push({ field: "Fixed Salary", message: "Invalid Fixed Salary" });
                        }
                        const working_hours_per_day = toNum(row["Working Hours/Day"] ?? row["working_hours_per_day"]);
                        if (typeof working_hours_per_day === "number" && (isNaN(working_hours_per_day) || working_hours_per_day < 0 || working_hours_per_day > 24)) {
                            fieldErrors.push({ field: "Working Hours/Day", message: "Invalid Working Hours/Day" });
                        }

                        if (email && EMAIL_RE.test(email) && !existingMap.has(email)) {
                            const firstSeenRow = seenEmails.get(email);
                            if (firstSeenRow !== undefined) {
                                fieldErrors.push({ field: "Email", message: `Duplicate staff record — already used in row ${firstSeenRow}` });
                            } else {
                                seenEmails.set(email, rowNum);
                            }
                        }

                        if (fieldErrors.length > 0) {
                            part.skipped += 1;
                            part.errors.push(...fieldErrors.map((fe) => ({
                                row: rowNum,
                                field: fe.field,
                                email: email || undefined,
                                code: "VALIDATION_ERROR",
                                message: fe.message,
                            })));
                            return part;
                        }

                        const nameParts = fullName.split(" ");
                        const first_name = nameParts[0] || email.split("@")[0];
                        const last_name = nameParts.slice(1).join(" ") || undefined;

                        const phone = phoneRaw || undefined;
                        const gender = genderRaw || undefined;
                        // The CSV's "Address" column is free text (street address),
                        // which belongs in the `address` field — not `country`
                        // (a short country code/name column, previously mismapped
                        // here and prone to overflowing its VARCHAR length).
                        const address = String(row["Address"] ?? row["address"] ?? "").trim() || undefined;
                        const job_title = String(row["Designation"] ?? row["designation"] ?? "").trim() || undefined;

                        const { birthday_day, birthday_month } = parseDOB(dobRaw);
                        const hasWage = typeof hourly_rate === "number" || typeof salary_amount === "number";

                        const existing = existingMap.get(email);

                        if (existing) {
                            if (!dry_run) {
                                await staffRepository.update(existing.id, salonId, {
                                    first_name, last_name, phone, gender, address, job_title,
                                    permission_level: permission_level ?? undefined,
                                    working_hours_per_day: typeof working_hours_per_day === "number" ? working_hours_per_day : undefined,
                                });
                                await staffRepository.updateDateFields(existing.id, salonId, { joined_date, birthday_day, birthday_month });
                                if (hasWage) {
                                    await staffWagesRepository.upsert(existing.id, {
                                        wages_enabled: true,
                                        compensation_type: typeof hourly_rate === "number" ? "hourly" : "salary",
                                        hourly_rate: typeof hourly_rate === "number" ? hourly_rate : undefined,
                                        salary_amount: typeof salary_amount === "number" ? salary_amount : undefined,
                                    });
                                }
                            }
                            part.updated += 1;
                        } else {
                            if (!dry_run) {
                                const staff = await staffRepository.create(salonId, {
                                    first_name, last_name, email, phone, gender, address, job_title,
                                    permission_level: permission_level ?? undefined,
                                    working_hours_per_day: typeof working_hours_per_day === "number" ? working_hours_per_day : undefined,
                                }, null, true); // activateImmediately = true: imported staff don't need email invites
                                await staffRepository.updateDateFields(staff.id, salonId, { joined_date, birthday_day, birthday_month });
                                if (hasWage) {
                                    await staffWagesRepository.upsert(staff.id, {
                                        wages_enabled: true,
                                        compensation_type: typeof hourly_rate === "number" ? "hourly" : "salary",
                                        hourly_rate: typeof hourly_rate === "number" ? hourly_rate : undefined,
                                        salary_amount: typeof salary_amount === "number" ? salary_amount : undefined,
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
            } else if (!user.is_verified) {
                // Never verified — either the placeholder account staffService.create
                // links up front now (see there), or an old abandoned signup. Either
                // way nobody has proven they know its current password, so it's safe
                // to set the one just chosen here.
                logger.info("acceptInvitation: unverified user exists — setting chosen password", { email: invitation.email, userId: user.id });
                const passwordHash = await bcrypt.hash(body.password, 10);
                await authRepository.updatePassword(user.id, passwordHash);
                await authRepository.updateUserRole(user.id, 'staff');
                user = { ...user, role: 'staff' };
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
    async getSalonSummary(
        salonId: string, month?: string, startDate?: string, endDate?: string,
        staffIds?: string[], category?: string
    ) {
        return commissionCalculationService.getSalonSummary(salonId, month, startDate, endDate, staffIds, category);
    },

    // ── Earned commissions grouped by staff ───────────────────────────────────
    async getEarnedBySalon(
        salonId: string, month?: string, startDate?: string, endDate?: string,
        staffIds?: string[], category?: string, status?: string
    ) {
        return commissionCalculationService.getEarnedBySalon(salonId, month, startDate, endDate, staffIds, category, status);
    },

    // ── Mark all pending commissions as paid for a staff member ───────────────
    async markStaffCommissionPaid(salonId: string, staffId: string) {
        return commissionCalculationService.markStaffPaid(salonId, staffId);
    },

    // ── Settle a specific amount (full or partial) against pending commission ──
    async settleStaffCommission(salonId: string, staffId: string, amount: number, settledBy?: string | null) {
        return commissionCalculationService.settleStaffCommission(salonId, staffId, amount, settledBy);
    },

    async getSettlementHistory(salonId: string, staffId: string, limit?: number) {
        return commissionCalculationService.getSettlementHistory(salonId, staffId, limit);
    },

    async upsertSlabs(staffId: string, salonId: string, category: string, slabs: any[]) {
        return commissionCalculationService.upsertSlabs(staffId, salonId, category, slabs);
    },

    async getSlabs(staffId: string, category?: string) {
        return commissionCalculationService.getSlabs(staffId, category);
    },

    async getStaffHistory(staffId: string, filters: {
        month?: string; start_date?: string; end_date?: string; status?: string; page?: number; limit?: number;
    } = {}) {
        return commissionCalculationService.getStaffHistory(staffId, filters);
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

// ─── Tip Settle ───────────────────────────────────────────────────────────────
// Thin delegation to tipCalculationService, same shape as staffCommissionsService
// above — tip_earned rows are created automatically at checkout (see
// tipCalculationService.earnForSale, hooked into appointments.service.ts /
// sales.service.ts alongside the existing commission calculation), so there's
// no upsert/config surface here, only summary/settle/history.

export const staffTipsService = {
    async getSalonSummary(salonId: string, startDate?: string, endDate?: string, staffIds?: string[]) {
        return tipCalculationService.getSalonSummary(salonId, startDate, endDate, staffIds);
    },

    async getEarnedBySalon(salonId: string, startDate?: string, endDate?: string, staffIds?: string[], status?: string) {
        return tipCalculationService.getEarnedBySalon(salonId, startDate, endDate, staffIds, status);
    },

    async markStaffTipPaid(salonId: string, staffId: string) {
        return tipCalculationService.markStaffPaid(salonId, staffId);
    },

    async settleStaffTip(salonId: string, staffId: string, amount: number, paymentMethod?: string | null, settledBy?: string | null) {
        return tipCalculationService.settleStaffTip(salonId, staffId, amount, paymentMethod, settledBy);
    },

    async getSettlementHistory(salonId: string, staffId: string, limit?: number) {
        return tipCalculationService.getSettlementHistory(salonId, staffId, limit);
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