import { Request } from "express";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import logger from "../../config/logger";

type AuthRequest = Request & { user?: { userId: string; id?: string; role?: string; salonId?: string | null } };

/**
 * Resolves the salon ID exclusively from the authenticated JWT.
 * Priority:
 * 1. salonId claim in the JWT payload (req.user.salonId) — authoritative
 * 2. DB owner lookup — fallback for tokens issued before salonId was embedded
 * 3. Throw AppError 403 if neither resolves
 *
 * The x-salon-id header is intentionally NOT consulted — it is client-supplied
 * and must not be trusted for multi-tenant isolation.
 */
export const getSalonId = async (req: Request): Promise<string> => {
  const authReq = req as AuthRequest;

  // 1. JWT salonId claim — primary and authoritative source
  const fromJwt = authReq.user?.salonId;
  if (fromJwt) return fromJwt;

  // 2. DB owner lookup — fallback for tokens that pre-date the salonId claim
  const userId = authReq.user?.userId || authReq.user?.id;

  if (!userId) {
    logger.warn("getSalonId failed: No salonId in JWT and no userId", {
      path: req.originalUrl,
      method: req.method,
    });
    throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  }

  const salon = await salonsRepository.findByOwnerId(userId);
  if (salon) {
    logger.info("getSalonId resolved via owner fallback", { userId, salonId: salon.id });
    return salon.id;
  }

  logger.warn("getSalonId failed: No salonId in JWT and no salon owned by user", { userId });
  throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
};
