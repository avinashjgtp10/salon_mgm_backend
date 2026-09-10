import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { invalidatePermissionCache, staffHasPermission } from "../../middleware/permission.middleware";
import { sendSuccess } from "../utils/response.util";
import { settingsService } from "./settings.service";
import { CreateSettingBody, UpdateSettingBody } from "./settings.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

// The `integrations_config` key holds plaintext third-party credentials
// (Razorpay/SMTP/Twilio/WhatsApp) — previously protected by nothing more
// than the generic `general_settings` permission any staff member could be
// granted for routine things like business hours. This adds a second,
// higher-risk check specifically for that one key, on top of the
// general_settings gate the route already requires. Owner/admin are
// unaffected (same unconditional bypass as every other permission check).
const INTEGRATIONS_KEY = "integrations_config";

async function assertCanWriteKey(req: AuthRequest, key: string): Promise<void> {
  if (key !== INTEGRATIONS_KEY) return;
  const role = req.user?.role;
  if (role === "salon_owner" || role === "admin") return;
  const salonId = req.user?.salonId;
  const userId = req.user?.userId;
  if (!salonId || !userId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  const allowed = await staffHasPermission({ userId, role, salonId }, "manage_integrations");
  if (!allowed) {
    throw new AppError(
      403,
      "You do not have permission to perform this action (manage_integrations)",
      "FORBIDDEN"
    );
  }
}

export const settingsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const data = await settingsService.list(salonId);
      sendSuccess(res, 200, data, "Settings fetched");
    } catch (err) { next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const data = await settingsService.getById(salonId, String(req.params.id));
      sendSuccess(res, 200, data, "Setting fetched");
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const body = req.body as CreateSettingBody;
      if (!body.key) throw new AppError(400, "key is required", "VALIDATION_ERROR");
      if (body.value === undefined) throw new AppError(400, "value is required", "VALIDATION_ERROR");
      await assertCanWriteKey(req, body.key);
      const data = await settingsService.create(salonId, body);
      if (body.key === "role_permissions") invalidatePermissionCache(salonId);
      sendSuccess(res, 201, data, "Setting created");
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const existing = await settingsService.getById(salonId, String(req.params.id));
      await assertCanWriteKey(req, existing.key);
      const data = await settingsService.update(salonId, String(req.params.id), req.body as UpdateSettingBody);
      invalidatePermissionCache(salonId);
      sendSuccess(res, 200, data, "Setting updated");
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const existing = await settingsService.getById(salonId, String(req.params.id));
      await assertCanWriteKey(req, existing.key);
      await settingsService.delete(salonId, String(req.params.id));
      sendSuccess(res, 200, null, "Setting deleted");
    } catch (err) { next(err); }
  },
};
