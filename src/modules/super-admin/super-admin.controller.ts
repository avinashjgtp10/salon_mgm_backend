import { Request, Response, NextFunction } from "express";
import { superAdminService } from "./super-admin.service";

export const superAdminController = {

  // ── AUTH ──────────────────────────────────────────────────────────────────────

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Email and password required" } });
      }
      const data = await superAdminService.login(email, password);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── FREQUENT / NO-PLAN LOGINS ────────────────────────────────────────────────

  async getFrequentLogins(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const data = await superAdminService.getFrequentLogins(limit);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getUsersWithoutSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const data = await superAdminService.getUsersWithoutSubscription(limit);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── RECENT LOGINS ────────────────────────────────────────────────────────────

  async getRecentLogins(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const data = await superAdminService.getRecentLogins(limit);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── STATS ─────────────────────────────────────────────────────────────────────

  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await superAdminService.getStats();
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── SALONS ────────────────────────────────────────────────────────────────────

  async getAllSalons(req: Request, res: Response, next: NextFunction) {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const data = await superAdminService.getAllSalons(search);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async setSalonStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = typeof req.params.id === "string" ? req.params.id : String(req.params.id);
      const { is_active } = req.body;
      if (typeof is_active !== "boolean") {
        return res.status(400).json({ success: false, error: { message: "is_active (boolean) required" } });
      }
      const data = await superAdminService.setSalonStatus(id, is_active);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async forceOnboarding(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const data = await superAdminService.forceCompleteOnboarding(id);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async impersonateSalon(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const data = await superAdminService.getImpersonateToken(id);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async impersonateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const data = await superAdminService.getImpersonateUserToken(id);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── SALON PERMISSIONS ────────────────────────────────────────────────────────

  async searchSalonsForPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const data = await superAdminService.searchSalonsForPermissions(q);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getSalonPermissionsById(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const data = await superAdminService.getSalonPermissionsById(salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async updateSalonPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const { permissions } = req.body;
      if (!permissions || typeof permissions !== "object") {
        return res.status(400).json({ success: false, error: { message: "permissions object required" } });
      }
      const data = await superAdminService.updateSalonPermissions(salonId, permissions);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { first_name, last_name, email, password, phone, role } = req.body;
      const data = await superAdminService.createUser({ first_name, last_name, email, password, phone, role });
      return res.status(201).json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getAllUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const role   = typeof req.query.role   === "string" ? req.query.role   : undefined;
      const data = await superAdminService.getAllUsers(search, role);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async setUserStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { is_active } = req.body;
      if (typeof is_active !== "boolean") {
        return res.status(400).json({ success: false, error: { message: "is_active (boolean) required" } });
      }
      const data = await superAdminService.setUserStatus(id, is_active);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async setUserRole(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { role } = req.body;
      const data = await superAdminService.setUserRole(id, role);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async resetUserPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { password } = req.body;
      const data = await superAdminService.resetUserPassword(id, password);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const data = await superAdminService.deleteUser(id);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

  async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const data = await superAdminService.getAllPayments(status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── BILLING ───────────────────────────────────────────────────────────────────

  async getAllSubscriptions(req: Request, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const data = await superAdminService.getAllSubscriptions(status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getAllPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await superAdminService.getAllPlans();
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },
};
