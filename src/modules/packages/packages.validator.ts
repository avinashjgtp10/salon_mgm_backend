import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

export const validateCreatePackage = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { name, basePrice, durationMinutes, category } = req.body;

    if (!name || typeof name !== "string" || name.trim().length < 3)
      throw new AppError(400, "name is required and must be at least 3 characters", "VALIDATION_ERROR");

    if (basePrice === undefined || isNaN(Number(basePrice)) || Number(basePrice) < 0)
      throw new AppError(400, "basePrice must be a non-negative number", "VALIDATION_ERROR");

    if (!durationMinutes || isNaN(Number(durationMinutes)) || Number(durationMinutes) < 5)
      throw new AppError(400, "durationMinutes must be at least 5", "VALIDATION_ERROR");

    if (!category || typeof category !== "string")
      throw new AppError(400, "category is required", "VALIDATION_ERROR");

    if (req.body.discountType && !["percentage", "fixed"].includes(req.body.discountType))
      throw new AppError(400, "discountType must be 'percentage' or 'fixed'", "VALIDATION_ERROR");

    return next();
  } catch (e) { return next(e); }
};

export const validateUpdatePackage = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    return next();
  } catch (e) { return next(e); }
};

export const validatePackagesListQuery = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    return next();
  } catch (e) { return next(e); }
};
