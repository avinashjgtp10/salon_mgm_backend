import { superAdminRepository } from "./super-admin.repository";
import { authRepository } from "../auth/auth.repository";
import { emailService } from "../utils/email.service";
import { AppError } from "../../middleware/error.middleware";
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

  async getImpersonateToken(salonId: string) {
    const ownerId = await superAdminRepository.getSalonOwnerId(salonId);
    if (!ownerId) throw new AppError(404, "Salon or owner not found", "NOT_FOUND");
    if (!ACCESS_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");
    const token = jwt.sign({ userId: ownerId, role: "salon_owner", salonId, impersonatedBy: "super_admin" }, ACCESS_SECRET, { expiresIn: "1h" } as any);
    return { token, isOnboardingComplete: true };
  },

  async getImpersonateUserToken(userId: string) {
    const user = await superAdminRepository.getUserForImpersonate(userId);
    if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
    if (!ACCESS_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");
    const token = jwt.sign(
      { userId: user.id, role: user.role, salonId: user.salon_id ?? null, impersonatedBy: "super_admin" },
      ACCESS_SECRET,
      { expiresIn: "1h" } as any
    );
    return { token, isOnboardingComplete: user.is_onboarding_complete };
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

  async getAllUsers(search?: string, role?: string, minLogins?: number) {
    return superAdminRepository.getAllUsers(search, role, minLogins);
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

  async getAllSubscriptions(statusFilter?: string) {
    return superAdminRepository.getAllSubscriptions(statusFilter);
  },

  async getAllPlans() {
    return superAdminRepository.getAllPlans();
  },
};
