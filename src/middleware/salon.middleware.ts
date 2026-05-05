import { Request, Response, NextFunction } from "express";
import { AppError } from "./error.middleware";

/**
 * requireSalon — must be placed AFTER authMiddleware.
 * Verifies the JWT contains a valid salonId claim.
 * Returns 403 if the authenticated user has no associated salon.
 */
export const requireSalon = (
  req: Request & { user?: any },
  _res: Response,
  next: NextFunction
): void => {
  const salonId = req.user?.salonId;
  if (!salonId) {
    next(
      new AppError(
        403,
        "Salon context required. Please complete salon onboarding.",
        "NO_SALON_CONTEXT"
      )
    );
    return;
  }
  next();
};
