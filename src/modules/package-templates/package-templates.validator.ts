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

export const validateCreatePackageTemplate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.basePrice !== "number" || !isNonNeg(req.body.basePrice))
      throw new AppError(400, "basePrice is required and must be a non-negative number", "VALIDATION_ERROR");
    validatePricing(req.body ?? {});
    return next();
  } catch (e) { return next(e); }
};

export const validateUpdatePackageTemplate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    validatePricing(req.body ?? {});
    return next();
  } catch (e) { return next(e); }
};
