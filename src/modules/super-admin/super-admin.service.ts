import { superAdminRepository } from "./super-admin.repository";
import { getSuperAdminOverview } from "./super-admin.overview";
import { getAllTimeRevenueBySalon } from "../salon-dashboard/salon-revenue";
import { supportRepo } from "../support/support.repository";
import { authRepository } from "../auth/auth.repository";
import { demoRequestsService } from "../demo-requests/demo-requests.service";
import { emailService } from "../utils/email.service";
import { AppError } from "../../middleware/error.middleware";
import logger from "../../config/logger";
import bcrypt from "bcrypt";
import jwt, { Secret, SignOptions } from "jsonwebtoken";

const ACCESS_SECRET: Secret  = process.env.JWT_ACCESS_SECRET  || "";
const REFRESH_SECRET: Secret = process.env.JWT_REFRESH_SECRET || "";
const accessOptions: SignOptions  = { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN  || "15m") as any };
const refreshOptions: SignOptions = { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") as any };

export const superAdminService = {

  // ── AUTH ──────────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const user = await superAdminRepository.findSuperAdminByEmail(email.toLowerCase().trim());
    if (!user) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    if (!user.is_active) throw new AppError(403, "Account is inactive", "USER_INACTIVE");

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");

    if (!ACCESS_SECRET || !REFRESH_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");

    const accessToken  = jwt.sign({ userId: user.id, role: "super_admin", salonId: null }, ACCESS_SECRET,  accessOptions);
    const refreshToken = jwt.sign({ userId: user.id },                                      REFRESH_SECRET, refreshOptions);

    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 30);
    await authRepository.saveRefreshToken({ user_id: user.id, token: refreshToken, expires_at: refreshExpiry });

    return {
      accessToken,
      refreshToken,
      user: {
        id:         user.id,
        email:      user.email,
        role:       "super_admin",
        first_name: user.first_name,
        last_name:  user.last_name,
        salonId:    null,
      },
    };
  },

  // ── FREQUENT LOGINS ──────────────────────────────────────────────────────────

  async getFrequentLogins(limit?: number) {
    return superAdminRepository.getFrequentLogins(limit);
  },

  async getUsersWithoutSubscription(limit?: number) {
    return superAdminRepository.getUsersWithoutSubscription(limit);
  },

  // ── RECENT LOGINS ────────────────────────────────────────────────────────────

  async getRecentLogins(limit?: number) {
    return superAdminRepository.getRecentLogins(limit);
  },

  // ── STATS ─────────────────────────────────────────────────────────────────────

  // Revenue is the salon website's own figure (Sales Summary "Received Amount",
  // i.e. the dashboard's allTimeRevenue), not SUM(payments.net_amount) — that
  // raw payments sum counted money the salon's reports exclude (cancelled /
  // deleted visits etc.), so Super Admin showed more than the salon itself.
  async _withSalonSiteRevenue<T extends { id: string; revenue?: unknown }>(salons: T[]): Promise<T[]> {
    const revenue = await getAllTimeRevenueBySalon(salons.map((s) => s.id));
    return salons.map((s) => (revenue.has(s.id) ? { ...s, revenue: revenue.get(s.id)! } : s));
  },

  async getStats() {
    const [stats, ids] = await Promise.all([superAdminRepository.getStats(), superAdminRepository.getAllSalonIds()]);
    const revenue = await getAllTimeRevenueBySalon(ids);
    const total = ids.reduce((sum, id) => sum + (revenue.get(id) ?? 0), 0);
    return { ...stats, total_revenue: revenue.size > 0 ? total : stats.total_revenue };
  },

  // The redesigned Overview page: KPIs, alerts, charts, activity and issue snapshot in one response.
  async getOverview(from?: string, to?: string, activeDays?: number) {
    return getSuperAdminOverview(from, to, activeDays);
  },

  // Everything the super-admin Overview page renders, in one round trip.
  async getDashboard(opts: { frequentLoginsLimit?: number; usersNoPlanLimit?: number } = {}) {
    const [stats, rawSalons, payments, frequentLogins, usersNoPlan, supportStats] = await Promise.all([
      superAdminRepository.getStats(),
      superAdminRepository.getAllSalons(),
      superAdminRepository.getAllPayments(),
      superAdminRepository.getFrequentLogins(opts.frequentLoginsLimit),
      superAdminRepository.getUsersWithoutSubscription(opts.usersNoPlanLimit),
      supportRepo.getStats(),
    ]);
    const salons = await this._withSalonSiteRevenue(rawSalons);
    const totalRevenue = salons.reduce((sum, s) => sum + (Number((s as { revenue?: unknown }).revenue) || 0), 0);
    return {
      stats: { ...stats, total_revenue: totalRevenue },
      salons,
      payments,
      frequent_logins: frequentLogins,
      users_no_plan: usersNoPlan,
      support_stats: supportStats,
    };
  },

  // ── SALONS ────────────────────────────────────────────────────────────────────

  async getAllSalons(search?: string, kind?: "real" | "dummy") {
    return this._withSalonSiteRevenue(await superAdminRepository.getAllSalons(search, kind));
  },

  // Moves a salon between the Real and Dummy lists.
  async setSalonDummy(id: string, isDummy: boolean) {
    const result = await superAdminRepository.setSalonDummy(id, isDummy);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return result;
  },

  async getSalonStaff(salonId: string) {
    return superAdminRepository.getSalonStaff(salonId);
  },

  async setSalonStatus(id: string, isActive: boolean) {
    const result = await superAdminRepository.setSalonStatus(id, isActive);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");

    // Fire-and-forget, like the staff-login alert email above — a slow or
    // broken SMTP server must never delay/fail this admin action.
    if (isActive === false) {
      (async () => {
        try {
          const contact = await superAdminRepository.getSalonOwnerContact(id);
          if (!contact?.owner_email) {
            logger.warn("[EMAIL] sendSalonDeactivatedEmail skipped — no owner email on file", { salonId: id });
            return;
          }
          await emailService.sendSalonDeactivatedEmail({
            to: contact.owner_email,
            salonName: contact.name,
            ownerName: contact.owner_name,
          });
          logger.info("[EMAIL] sendSalonDeactivatedEmail sent", { salonId: id, to: contact.owner_email });
        } catch (err: any) {
          logger.error("[EMAIL] sendSalonDeactivatedEmail FAILED", { salonId: id, error: err?.message });
        }
      })();
    }

    return result;
  },

  async forceCompleteOnboarding(id: string) {
    const result = await superAdminRepository.forceCompleteOnboarding(id);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return result;
  },

  // The impersonated tab is a fully separate browser window/store from the
  // super admin's own tab — it never has the super admin's session to fall
  // back on, so a short-lived, refresh-less access token eventually expires
  // and the frontend's normal silent-refresh path finds nothing to exchange,
  // hard-logging the admin out mid-session (surfacing as an unexpected
  // forced re-login inside the salon account). The real fix is giving the
  // impersonated tab its own refresh token — routed through the exact same
  // /auth/refresh endpoint every other session already uses (auth.service.ts
  // refresh() re-derives the impersonated user's real role/salonId from the
  // DB by userId, so it needs no special-casing there) — but capped to a
  // short DB-side expiry (impersonateRefreshExpiryDate) rather than the
  // normal 30-day one, since this token is otherwise indistinguishable from
  // the impersonated user's own real refresh token if it ever leaked.
  async getImpersonateToken(salonId: string) {
    const ownerId = await superAdminRepository.getSalonOwnerId(salonId);
    if (!ownerId) throw new AppError(404, "Salon or owner not found", "NOT_FOUND");
    if (!ACCESS_SECRET || !REFRESH_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");
    // Own session row first (never deletes the owner's real sessions), so the
    // access token can carry its id: a real login by the owner later ends
    // this impersonation instantly, instead of lingering for the token's 1h.
    const { refreshToken, sid } = await this._issueImpersonationRefreshToken(ownerId);
    const token = jwt.sign({ userId: ownerId, role: "salon_owner", salonId, impersonatedBy: "super_admin", sid }, ACCESS_SECRET, { expiresIn: "1h" } as any);
    return { token, refreshToken, isOnboardingComplete: true };
  },

  async getImpersonateUserToken(userId: string) {
    const user = await superAdminRepository.getUserForImpersonate(userId);
    if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
    if (!ACCESS_SECRET || !REFRESH_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");
    const { refreshToken, sid } = await this._issueImpersonationRefreshToken(user.id);
    const token = jwt.sign(
      { userId: user.id, role: user.role, salonId: user.salon_id ?? null, impersonatedBy: "super_admin", sid },
      ACCESS_SECRET,
      { expiresIn: "1h" } as any
    );
    return { token, refreshToken, isOnboardingComplete: user.is_onboarding_complete };
  },

  // Signed with the same REFRESH_SECRET and persisted in the same
  // refresh_tokens table as a normal login's refresh token, so
  // authService.refresh() accepts it completely unmodified — the only
  // difference is a much shorter DB-side expires_at (8h instead of 30d),
  // which is the authoritative check refresh() makes before ever looking at
  // the JWT's own exp claim.
  // Returns the new row's id as `sid` too — the impersonation access token
  // carries it so the session can be ended like any other (see
  // auth/session.util.ts). Adding this row never deletes the real user's own.
  async _issueImpersonationRefreshToken(userId: string): Promise<{ refreshToken: string; sid: string }> {
    const refreshToken = jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: "8h" } as any);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const row = await authRepository.saveRefreshToken({ user_id: userId, token: refreshToken, expires_at: expiresAt });
    return { refreshToken, sid: String(row.id) };
  },

  // ── SALON PERMISSIONS ────────────────────────────────────────────────────────

  async searchSalonsForPermissions(query: string) {
    return superAdminRepository.searchSalonsForPermissions(query ?? "");
  },

  async getSalonPermissionsById(salonId: string) {
    const salon = await superAdminRepository.getSalonPermissionsById(salonId);
    if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
    let permissions: Record<string, { owner: boolean; staff: boolean }> = {};
    if (salon.role_permissions) {
      try { permissions = JSON.parse(salon.role_permissions); } catch { permissions = {}; }
    }
    return { salon: { id: salon.id, name: salon.name, owner_email: salon.owner_email, owner_name: salon.owner_name, plan_name: salon.plan_name, is_active: salon.is_active }, permissions };
  },

  async updateSalonPermissions(salonId: string, permissions: Record<string, { owner: boolean; staff: boolean; manager?: boolean }>) {
    if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    const result = await superAdminRepository.updateSalonPermissions(salonId, permissions);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return result;
  },

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async createUser(data: { first_name: string; last_name?: string; email: string; password: string; phone?: string; role: string; business_name?: string; address?: string; is_dummy?: boolean }, createdByUserId?: string) {
    const allowed = ["salon_owner", "admin", "staff", "client", "branch_owner"];
    if (!allowed.includes(data.role)) throw new AppError(400, "Invalid role", "VALIDATION_ERROR");
    if (!data.email?.trim()) throw new AppError(400, "Email is required", "VALIDATION_ERROR");
    if (!data.password || data.password.length < 6) throw new AppError(400, "Password must be at least 6 characters", "VALIDATION_ERROR");
    if (/\s/.test(data.password)) throw new AppError(400, "Password cannot contain spaces", "VALIDATION_ERROR");
    if (!data.first_name?.trim()) throw new AppError(400, "First name is required", "VALIDATION_ERROR");
    if (data.role === "salon_owner" && !data.business_name?.trim()) throw new AppError(400, "Business name is required for Salon Owner", "VALIDATION_ERROR");

    const password_hash = await bcrypt.hash(data.password, 10);
    const user = await superAdminRepository.createUser({
      first_name: data.first_name.trim(),
      last_name: data.last_name?.trim(),
      email: data.email,
      password_hash,
      phone: data.phone?.trim(),
      role: data.role,
      business_name: data.business_name?.trim(),
      address: data.address?.trim(),
      is_dummy: data.is_dummy === true,
      createdByUserId: createdByUserId?.trim() || undefined,
    });

    // Send credentials email (fire-and-forget — don't fail account creation if mail fails)
    emailService.sendAccountCreatedEmail({
      to: data.email,
      fullName: `${data.first_name.trim()}${data.last_name ? " " + data.last_name.trim() : ""}`,
      email: data.email,
      password: data.password,
      role: data.role,
    }).catch((err: any) => logger.error("⚠️  Failed to send account-created email:", err?.message));

    return { ...user, plainPassword: data.password };
  },

  async deleteSalon(id: string, deletedByUserId: string, reason?: string) {
    if (!id) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    if (!deletedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const result = await superAdminRepository.deleteSalon(id, deletedByUserId, reason);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return { success: true };
  },

  async getDeletedAccountHistory(opts: { search?: string; accountType?: string; page: number; perPage: number }) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage || 20));
    return superAdminRepository.getDeletedAccountHistory({
      search: opts.search,
      accountType: opts.accountType,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
  },

  async clearSalonData(id: string, clearedByUserId: string, reason?: string) {
    if (!id) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    if (!clearedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const cleared = await superAdminRepository.clearSalonData(id, clearedByUserId, reason);
    if (!cleared) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return { success: true };
  },

  async getSalonCleanupHistory(opts: { search?: string; page: number; perPage: number }) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage || 20));
    return superAdminRepository.getSalonCleanupHistory({
      search: opts.search,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
  },

  async getAllUsers(search?: string, role?: string, minLogins?: number) {
    return superAdminRepository.getAllUsers(search, role, minLogins);
  },

  async getAllDemoRequests(search?: string) {
    return demoRequestsService.list(search);
  },

  async setDemoRequestStatus(id: string, status: string) {
    return demoRequestsService.updateStatus(id, status);
  },

  async setUserStatus(id: string, isActive: boolean) {
    const result = await superAdminRepository.setUserStatus(id, isActive);
    if (!result) throw new AppError(404, "User not found", "NOT_FOUND");
    return result;
  },

  async updateUser(id: string, data: { first_name: string; last_name?: string; email: string; phone?: string }) {
    if (!data.first_name?.trim()) throw new AppError(400, "First name is required", "VALIDATION_ERROR");
    if (!data.email?.trim()) throw new AppError(400, "Email is required", "VALIDATION_ERROR");

    const taken = await superAdminRepository.emailTakenByAnotherUser(data.email, id);
    if (taken) throw new AppError(409, "Another account already uses this email address", "DUPLICATE_EMAIL");

    const result = await superAdminRepository.updateUser(id, {
      first_name: data.first_name.trim(),
      last_name: data.last_name?.trim(),
      email: data.email,
      phone: data.phone?.trim(),
    });
    if (!result) throw new AppError(404, "User not found", "NOT_FOUND");
    return result;
  },

  async setUserRole(id: string, role: string) {
    const allowed = ["salon_owner", "admin", "staff", "client", "branch_owner"];
    if (!allowed.includes(role)) throw new AppError(400, "Invalid role", "VALIDATION_ERROR");
    const result = await superAdminRepository.setUserRole(id, role);
    if (!result) throw new AppError(404, "User not found", "NOT_FOUND");
    return result;
  },

  async resetUserPassword(id: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) throw new AppError(400, "Password must be at least 6 characters", "VALIDATION_ERROR");
    await superAdminRepository.resetUserPassword(id, newPassword);
    return { success: true };
  },

  async deleteUser(id: string, deletedByUserId: string, reason?: string) {
    if (!id) throw new AppError(400, "User ID required", "VALIDATION_ERROR");
    if (!deletedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const result = await superAdminRepository.deleteUser(id, deletedByUserId, reason);
    if (!result) throw new AppError(404, "User not found", "NOT_FOUND");
    if ("blocked" in result && result.blocked === "owns_salon") {
      throw new AppError(
        409,
        "This user owns a salon. Transfer or delete the salon before deleting this account.",
        "USER_OWNS_SALON",
      );
    }
    return { success: true };
  },

  // ── BRANCH OWNER SALON ASSIGNMENT ────────────────────────────────────────────

  async getBranchOwnerSalons(branchOwnerId: string) {
    const user = await superAdminRepository.getUserById(branchOwnerId);
    if (!user || user.role !== "branch_owner") throw new AppError(404, "Branch owner not found", "NOT_FOUND");
    return superAdminRepository.getBranchOwnerSalons(branchOwnerId);
  },

  async assignSalonsToBranchOwner(branchOwnerId: string, salonIds: string[], assignedBy: string) {
    const user = await superAdminRepository.getUserById(branchOwnerId);
    if (!user || user.role !== "branch_owner") throw new AppError(404, "Branch owner not found", "NOT_FOUND");
    if (!Array.isArray(salonIds)) throw new AppError(400, "salonIds must be an array", "VALIDATION_ERROR");
    await superAdminRepository.replaceBranchOwnerSalons(branchOwnerId, salonIds, assignedBy);
    return superAdminRepository.getBranchOwnerSalons(branchOwnerId);
  },

  async unassignSalonFromBranchOwner(branchOwnerId: string, salonId: string) {
    await superAdminRepository.unassignSalon(branchOwnerId, salonId);
    return { success: true };
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

  async getAllPayments(statusFilter?: string) {
    return superAdminRepository.getAllPayments(statusFilter);
  },

  // ── BILLING ───────────────────────────────────────────────────────────────────

};
