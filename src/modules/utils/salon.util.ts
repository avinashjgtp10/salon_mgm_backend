import { Request } from "express";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import logger from "../../config/logger";

type AuthRequest = Request & { user?: { userId: string; id?: string; role?: string } };

/**
 * Resolves the salon ID from the request.
 * Priority:
 * 1. x-salon-id header
 * 2. Look up the salon owned by the authenticated user (fallback)
 * 3. Throw AppError 400 if neither works
 */
export const getSalonId = async (req: Request): Promise<string> => {
  const authReq = req as AuthRequest;
  
  // 1. Try header
  const fromHeader = String(req.headers["x-salon-id"] ?? "").trim();
  if (fromHeader) return fromHeader;

  // 2. Try Fallback (Owner lookup)
  const userId = authReq.user?.userId || authReq.user?.id;
  
  if (!userId) {
    logger.warn("getSalonId failed: No userId in request and no x-salon-id header", {
      path: req.originalUrl,
      method: req.method,
      hasUser: !!authReq.user,
    });
    throw new AppError(400, "x-salon-id header is required", "VALIDATION_ERROR");
  }

  const salon = await salonsRepository.findByOwnerId(userId);
  if (salon) {
    logger.info("getSalonId resolved via owner fallback", { userId, salonId: salon.id });
    return salon.id;
  }

  logger.warn("getSalonId failed: User has no salon and no x-salon-id header", { userId });
  throw new AppError(400, "x-salon-id header is required and no default salon found for your account", "VALIDATION_ERROR");
};
