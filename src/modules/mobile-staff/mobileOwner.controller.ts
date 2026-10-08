import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { getSalonId } from "../utils/tenant.util";
import {
  getStaffMobileCalendarAccess,
  listStaffMobileCalendarAccess,
  setStaffMobileCalendarAccess,
} from "./mobileCalendarAccess";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The staff id comes from the URL, so it is only ever matched together with
// the caller's own salon (getSalonId → JWT) — another salon's staff is a 404.
const getStaffId = (req: AuthRequest): string => {
  const staffId = String(req.params.staffId ?? "");
  if (!UUID_PATTERN.test(staffId)) throw new AppError(404, "Staff member not found", "NOT_FOUND");
  return staffId;
};

export const mobileOwnerController = {
  async listCalendarAccess(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const items = await listStaffMobileCalendarAccess(getSalonId(req));
      return sendSuccess(res, 200, { items }, "Calendar access fetched successfully");
    } catch (err) { return next(err); }
  },

  async getCalendarAccess(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const staffId = getStaffId(req);
      const calendarAccess = await getStaffMobileCalendarAccess(staffId, getSalonId(req));
      return sendSuccess(res, 200, { staffId, calendarAccess }, "Calendar access fetched successfully");
    } catch (err) { return next(err); }
  },

  async setCalendarAccess(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const staffId = getStaffId(req);
      const enabled = (req.body as { calendarAccess?: unknown } | undefined)?.calendarAccess;
      if (typeof enabled !== "boolean") {
        throw new AppError(400, "calendarAccess is required and must be a boolean", "VALIDATION_ERROR");
      }
      const calendarAccess = await setStaffMobileCalendarAccess(staffId, getSalonId(req), enabled);
      return sendSuccess(res, 200, { staffId, calendarAccess }, "Calendar access updated successfully");
    } catch (err) { return next(err); }
  },
};
