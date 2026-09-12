import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { invalidatePermissionCache, staffHasPermission } from "../../middleware/permission.middleware";
import { sendSuccess } from "../utils/response.util";
import { settingsService } from "./settings.service";
import { CreateSettingBody, UpdateSettingBody } from "./settings.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

// This generic key-value endpoint is shared by ~13 distinct Settings
// sections, differentiated only by `key` — the route itself has no way to
// know which section a write belongs to, so per-key permission checking
// happens here instead of a single blanket route guard. Replaces the old
// general_settings permission entirely (removed from the route, removed
// from the catalog — see remove_general_settings_permission_key.sql): every
// known key below now requires its own dedicated Settings sections-ticket
// permission, and anything NOT explicitly listed is denied by default
// rather than silently falling through to a catch-all like general_settings
// used to. Owner/admin bypass everywhere, same as every other check.
const INTEGRATIONS_KEY = "integrations_config";
const TAX_MODULE_KEY = "TAX_MODULE_CONFIG";
const KEY_TO_PERMISSION: Record<string, string> = {
  [INTEGRATIONS_KEY]: "view_settings_integrations",
  notification_preferences: "view_settings_notifications",
  whatsapp_notification_preferences: "view_settings_notifications",
  REWARD_POINTS_CONFIG: "view_settings_reward_points",
  REFERRAL_CONFIG: "view_settings_referral",
  PRINT_CONFIG: "view_settings_print",
  package_no_show_policy: "view_settings_packages",
  [TAX_MODULE_KEY]: "view_settings_tax_mapping",
};

async function assertCanWriteKey(req: AuthRequest, key: string): Promise<void> {
  const role = req.user?.role;
  if (role === "salon_owner" || role === "admin") return;
  const salonId = req.user?.salonId;
  const userId = req.user?.userId;
  if (!salonId || !userId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

  const deny = (permKey: string): never => {
    throw new AppError(
      403,
      `You do not have permission to perform this action (${permKey})`,
      "FORBIDDEN"
    );
  };
  const requirePerm = async (permKey: string) => {
    if (!(await staffHasPermission({ userId, role, salonId }, permKey))) deny(permKey);
  };

  // subscription_permissions is meant to be super-admin-controlled only —
  // no staff-grantable key unlocks it, ever, via this generic endpoint
  // (staff/owner/admin can never write it here; only the dedicated
  // super-admin subscription-permissions route can).
  if (key === "subscription_permissions") {
    throw new AppError(403, "You do not have permission to perform this action", "FORBIDDEN");
  }

  // role_permissions used to be writable by anyone holding general_settings
  // alone — a known loophole (the salon-wide staff permission matrix could
  // be rewritten by someone with, say, just business-hours access). Closed
  // by requiring the real permission-editing key instead.
  if (key === "role_permissions") return requirePerm("manage_roles");

  if (key === INTEGRATIONS_KEY) {
    // Plaintext third-party credentials (Razorpay/SMTP/Twilio/WhatsApp) — a
    // second, higher-risk check on top of the section-access permission,
    // same as before.
    await requirePerm("view_settings_integrations");
    return requirePerm("manage_integrations");
  }

  const mapped = KEY_TO_PERMISSION[key];
  if (mapped) return requirePerm(mapped);

  // Tax Mapping's individual tax rows use the tax's own free-text name as
  // the settings `key` (see SettingsManagementPage.tsx) — there's no fixed
  // key to list above, so anything unrecognized that isn't one of the
  // explicitly-handled keys above falls through to Tax Mapping's own
  // permission. subscription_permissions/role_permissions are matched
  // first, above, specifically so a tax named exactly one of those strings
  // can never shadow their stricter checks (a real, previously-flagged gap
  // in the old reserved-key-free design).
  return requirePerm("view_settings_tax_mapping");
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
