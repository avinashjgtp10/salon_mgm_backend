import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

export const validateCreateMembership = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { name, price, sessionType, validFor, colour, enableOnlineSales, enableOnlineRedemption } = req.body;
    if (!name || typeof name !== "string")
      throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (price === undefined || isNaN(Number(price)))
      throw new AppError(400, "price is required and must be a number", "VALIDATION_ERROR");
    if (!sessionType)
      throw new AppError(400, "sessionType is required", "VALIDATION_ERROR");
    if (!validFor)
      throw new AppError(400, "validFor is required", "VALIDATION_ERROR");
    if (!colour)
      throw new AppError(400, "colour is required", "VALIDATION_ERROR");
    if (enableOnlineSales === undefined)
      throw new AppError(400, "enableOnlineSales is required", "VALIDATION_ERROR");
    if (enableOnlineRedemption === undefined)
      throw new AppError(400, "enableOnlineRedemption is required", "VALIDATION_ERROR");
    return next();
  } catch (e) { return next(e); }
};

export const validateUpdateMembership = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    return next();
  } catch (e) { return next(e); }
};

export const validateMembershipsListQuery = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    return next();
  } catch (e) { return next(e); }
};