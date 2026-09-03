import { superAdminRepository } from "./super-admin.repository";
import { authRepository } from "../auth/auth.repository";
import { demoRequestsService } from "../demo-requests/demo-requests.service";
import { emailService } from "../utils/email.service";
import { AppError } from "../../middleware/error.middleware";
import { invalidateSubscriptionPermCache } from "../../middleware/subscriptionPermission.middleware";
import { subscriptionsRepository } from "../subscriptions/subscriptions.repository";
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

  async getStats() {
    return superAdminRepository.getStats();
  },

  // ── SALONS ────────────────────────────────────────────────────────────────────

  async getAllSalons(search?: string) {
    return superAdminRepository.getAllSalons(search);
  },

  async getSalonStaff(salonId: string) {
    return superAdminRepository.getSalonStaff(salonId);
  },

  async setSalonStatus(id: string, isActive: boolean) {
    const result = await superAdminRepository.setSalonStatus(id, isActive);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
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
    const token = jwt.sign({ userId: ownerId, role: "salon_owner", salonId, impersonatedBy: "super_admin" }, ACCESS_SECRET, { expiresIn: "1h" } as any);
    const refreshToken = await this._issueImpersonationRefreshToken(ownerId);
    return { token, refreshToken, isOnboardingComplete: true };
  },

  async getImpersonateUserToken(userId: string) {
    const user = await superAdminRepository.getUserForImpersonate(userId);
    if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
    if (!ACCESS_SECRET || !REFRESH_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");
    const token = jwt.sign(
      { userId: user.id, role: user.role, salonId: user.salon_id ?? null, impersonatedBy: "super_admin" },
      ACCESS_SECRET,
      { expiresIn: "1h" } as any
    );
    const refreshToken = await this._issueImpersonationRefreshToken(user.id);
    return { token, refreshToken, isOnboardingComplete: user.is_onboarding_complete };
  },

  // Signed with the same REFRESH_SECRET and persisted in the same
  // refresh_tokens table as a normal login's refresh token, so
  // authService.refresh() accepts it completely unmodified — the only
  // difference is a much shorter DB-side expires_at (8h instead of 30d),
  // which is the authoritative check refresh() makes before ever looking at
  // the JWT's own exp claim.
  async _issueImpersonationRefreshToken(userId: string): Promise<string> {
    const refreshToken = jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: "8h" } as any);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await authRepository.saveRefreshToken({ user_id: userId, token: refreshToken, expires_at: expiresAt });
    return refreshToken;
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

  // ── SUBSCRIPTION PERMISSIONS ──────────────────────────────────────────────────

  async searchSalonsForSubscriptionPermissions(query: string) {
    return superAdminRepository.searchSalonsForSubscriptionPermissions(query ?? "");
  },

  async getSubscriptionPermissionsById(salonId: string) {
    const salon = await superAdminRepository.getSubscriptionPermissionsById(salonId);
    if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
    let permissions: Record<string, boolean> = {};
    if (salon.subscription_permissions) {
      try { permissions = JSON.parse(salon.subscription_permissions); } catch { permissions = {}; }
    }
    return {
      salon: { id: salon.id, name: salon.name, owner_email: salon.owner_email, owner_name: salon.owner_name, plan_name: salon.plan_name, is_active: salon.is_active },
      permissions,
    };
  },

  async updateSubscriptionPermissions(salonId: string, permissions: Record<string, boolean>, changedByUserId: string) {
    if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    if (!changedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const result = await superAdminRepository.updateSubscriptionPermissions(salonId, permissions, changedByUserId);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    // Applies immediately, no logout required — requireSubscriptionPermission()
    // re-reads salon_settings per request (with a short cache); this
    // invalidation makes the very next request see the new values instead of
    // waiting out the cache TTL.
    invalidateSubscriptionPermCache(salonId);
    return result;
  },

  async getSubscriptionPermissionAuditLog(salonId: string) {
    if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    return superAdminRepository.getSubscriptionPermissionAuditLog(salonId);
  },

  // ── GRANT SUBSCRIPTION DAYS (manual comp/override) ────────────────────────────
  // Enter N days, the account gets exactly N days — nothing more, nothing
  // less. If a subscription row already exists, extends its
  // current_period_end. If the account has NONE yet, creates one directly
  // (no Razorpay, no plan picker) so this works for every account
  // unconditionally. Either way, status is forced to 'active' — the exact
  // field useSubscriptionPoller.ts reads to decide whether to show
  // SubscriptionWall — so access is restored/extended immediately, no
  // logout needed.
  async grantSubscriptionDays(salonId: string, days: number, changedByUserId: string) {
    if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    if (!Number.isFinite(days) || days <= 0) throw new AppError(400, "days must be a positive number", "VALIDATION_ERROR");
    if (!changedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const existing = await subscriptionsRepository.findMostRecentBySalonId(salonId);

    let updated;
    if (existing) {
      updated = await subscriptionsRepository.extendSubscriptionDays(existing.id, days);
    } else {
      // subscriptions.plan_id is NOT NULL (FK to subscription_plans) — the
      // caller only cares about days, not which plan, so just take any
      // existing plan. Plans already exist for the normal Upgrade flow to
      // work at all, so listPlans() returning empty here would itself be a
      // pre-existing data problem, not something this feature should mask.
      const plans = await subscriptionsRepository.listPlans();
      if (plans.length === 0) {
        throw new AppError(500, "No subscription plans exist to attach this grant to", "NO_PLANS_CONFIGURED");
      }
      updated = await subscriptionsRepository.createManualSubscription({
        salon_id: salonId,
        plan_id: plans[0].id,
        days,
      });
    }

    // Reuse the subscription_permission_audit_log table for this too — same
    // "who changed what, when" shape the ticket asked for, just a different
    // action type inside new_value instead of a permission map.
    await superAdminRepository.logSubscriptionGrantDays(salonId, changedByUserId, days, updated.current_period_end as string);

    return { subscription: updated, days_granted: days };
  },

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async createUser(data: { first_name: string; last_name?: string; email: string; password: string; phone?: string; role: string; business_name?: string; address?: string }) {
    const allowed = ["salon_owner", "admin", "staff", "client"];
    if (!allowed.includes(data.role)) throw new AppError(400, "Invalid role", "VALIDATION_ERROR");
    if (!data.email?.trim()) throw new AppError(400, "Email is required", "VALIDATION_ERROR");
    if (!data.password || data.password.length < 6) throw new AppError(400, "Password must be at least 6 characters", "VALIDATION_ERROR");
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
    });

    // Send credentials email (fire-and-forget — don't fail account creation if mail fails)
    emailService.sendAccountCreatedEmail({
      to: data.email,
      fullName: `${data.first_name.trim()}${data.last_name ? " " + data.last_name.trim() : ""}`,
      email: data.email,
      password: data.password,
      role: data.role,
    }).catch((err: any) => console.error("⚠️  Failed to send account-created email:", err?.message));

    return { ...user, plainPassword: data.password };
  },

  async deleteSalon(id: string) {
    if (!id) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    const result = await superAdminRepository.deleteSalon(id);
    if (!result) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return { success: true };
  },

  async clearSalonData(id: string) {
    if (!id) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
    const cleared = await superAdminRepository.clearSalonData(id);
    if (!cleared) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return { success: true };
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

  async setUserRole(id: string, role: string) {
    const allowed = ["salon_owner", "admin", "staff", "client"];
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

  async deleteUser(id: string) {
    if (!id) throw new AppError(400, "User ID required", "VALIDATION_ERROR");
    const result = await superAdminRepository.deleteUser(id);
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

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

  async getAllPayments(statusFilter?: string) {
    return superAdminRepository.getAllPayments(statusFilter);
  },

  // ── BILLING ───────────────────────────────────────────────────────────────────

};
