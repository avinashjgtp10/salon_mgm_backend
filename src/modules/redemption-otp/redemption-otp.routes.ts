import { Router, Request, Response, NextFunction } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { redemptionOtpService } from "./redemption-otp.service";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const router = Router();

// Checkout is where redemption happens, so the same keys that open Quick Sale /
// Calendar checkout may ask for and enter the code.
const auth = [
  authMiddleware,
  requireSalon,
  roleMiddleware("salon_owner", "admin", "staff"),
  requireAnyPermission(["create_sales", "manage_calendar"]),
];

const clientIdOf = (v: unknown): string => {
  const id = String(v ?? "").trim();
  if (!id) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
  return id;
};

router.get("/status", ...auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await redemptionOtpService.status(req.user!.salonId!, clientIdOf(req.query.clientId));
    return sendSuccess(res, 200, data, "Redemption OTP status");
  } catch (e) { return next(e); }
});

router.post("/request", ...auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await redemptionOtpService.request(req.user!.salonId!, clientIdOf(req.body?.clientId), req.user?.userId);
    return sendSuccess(res, 200, data, "OTP sent");
  } catch (e) { return next(e); }
});

router.post("/verify", ...auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await redemptionOtpService.verify(req.user!.salonId!, clientIdOf(req.body?.clientId), req.body?.code);
    return sendSuccess(res, 200, data, "OTP verified");
  } catch (e) { return next(e); }
});

export default router;
