import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

export const validateCreateMembership = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const {
      name, price, sessionType, validFor,
      colour, enableOnlineSales, enableOnlineRedemption, includedServices
    } = req.body;
    if (!name || typeof name !== "string")
      throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!Array.isArray(includedServices))
      throw new AppError(400, "includedServices must be an array", "VALIDATION_ERROR");
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

export const validateUpdateMembership = (
  _req: Request, _res: Response, next: NextFunction
) => next();

export const validateMembershipsListQuery = (
  req: Request, _res: Response, next: NextFunction
) => {
  try {
    const { page, limit } = req.query;
    if (page && isNaN(Number(page)))
      throw new AppError(400, "page must be a number", "VALIDATION_ERROR");
    if (limit && isNaN(Number(limit)))
      throw new AppError(400, "limit must be a number", "VALIDATION_ERROR");
    return next();
  } catch (e) { return next(e); }
};

export const validateExportQuery = (
  _req: Request, _res: Response, next: NextFunction
) => next();