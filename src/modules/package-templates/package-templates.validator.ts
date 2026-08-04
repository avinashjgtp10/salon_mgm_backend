import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonNeg = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function validatePricing(b: Record<string, any>): void {
  if (b.basePrice !== undefined && !isNonNeg(b.basePrice))
    throw new AppError(400, "basePrice must be a non-negative number", "VALIDATION_ERROR");
  if (Array.isArray(b.services)) {
    b.services.forEach((s: any, i: number) => {
      if (s.price !== undefined && !isNonNeg(s.price))
        throw new AppError(400, `services[${i}].price must be a non-negative number`, "VALIDATION_ERROR");
    });
  }
}

// A template's expiryDays of 0 (or negative) means any package instance
// purchased from it would be born already expired (client_packages.expiry_date
// = purchase date + expiryDays) — still selectable in Quick Sale/Calendar but
// useless the moment it's bought. Client-side validation guards this too, but
// this is the last line of defense since it's what actually reaches the DB.
function validateExpiry(b: Record<string, any>): void {
  if (b.neverExpires === true) return;
  if (b.expiryDays !== undefined && b.expiryDays !== null && b.expiryDays <= 0)
    throw new AppError(400, "expiryDays must be greater than 0 (or set neverExpires to true)", "VALIDATION_ERROR");
  if (b.expiryMonths !== undefined && b.expiryMonths !== null && b.expiryMonths <= 0)
    throw new AppError(400, "expiryMonths must be greater than 0 (or set neverExpires to true)", "VALIDATION_ERROR");
}

export const validateCreatePackageTemplate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.basePrice !== "number" || !isNonNeg(req.body.basePrice))
      throw new AppError(400, "basePrice is required and must be a non-negative number", "VALIDATION_ERROR");
    validatePricing(req.body ?? {});
    validateExpiry(req.body ?? {});
    return next();
  } catch (e) { return next(e); }
};

export const validateUpdatePackageTemplate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    validatePricing(req.body ?? {});
    validateExpiry(req.body ?? {});
    return next();
  } catch (e) { return next(e); }
};
