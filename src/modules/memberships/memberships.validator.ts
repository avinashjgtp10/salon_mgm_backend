import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const PRICING_TYPES = ["value", "percentage", "loyalty"];
const APPLIES_TO_VALUES = ["services", "products", "both"];

// Shared by create and update — on update every field is optional, so each check
// is gated on the field actually being present.
const validatePricingFields = (body: any) => {
  const {
    pricingType, discountPercent, discountBalance,
    loyaltyThresholdValue, appliesTo,
  } = body;

  if (pricingType !== undefined && !PRICING_TYPES.includes(pricingType))
    throw new AppError(400, `pricingType must be one of: ${PRICING_TYPES.join(", ")}`, "VALIDATION_ERROR");

  if (appliesTo !== undefined && !APPLIES_TO_VALUES.includes(appliesTo))
    throw new AppError(400, `appliesTo must be one of: ${APPLIES_TO_VALUES.join(", ")}`, "VALIDATION_ERROR");

  if (discountPercent !== undefined && discountPercent !== null &&
      (isNaN(Number(discountPercent)) || Number(discountPercent) < 0 || Number(discountPercent) > 100))
    throw new AppError(400, "discountPercent must be between 0 and 100", "VALIDATION_ERROR");

  if (discountBalance !== undefined && discountBalance !== null &&
      (isNaN(Number(discountBalance)) || Number(discountBalance) < 0))
    throw new AppError(400, "discountBalance must be a non-negative number", "VALIDATION_ERROR");

  if (loyaltyThresholdValue !== undefined && loyaltyThresholdValue !== null &&
      (isNaN(Number(loyaltyThresholdValue)) || Number(loyaltyThresholdValue) < 1))
    throw new AppError(400, "loyaltyThresholdValue must be a positive number", "VALIDATION_ERROR");

  // A loyalty plan without a threshold would unlock for everyone immediately, and
  // without a percentage it would grant nothing — neither is ever intended.
  if (pricingType === "loyalty") {
    if (loyaltyThresholdValue === undefined || loyaltyThresholdValue === null)
      throw new AppError(400, "loyaltyThresholdValue is required for a loyalty membership", "VALIDATION_ERROR");
    if (!Number(discountPercent))
      throw new AppError(400, "discountPercent is required for a loyalty membership", "VALIDATION_ERROR");
  }

  if (pricingType === "percentage" && !Number(discountPercent))
    throw new AppError(400, "discountPercent is required for a percentage membership", "VALIDATION_ERROR");
};

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
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0)
      throw new AppError(400, "price is required and must be a non-negative number", "VALIDATION_ERROR");
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
    validatePricingFields(req.body);
    return next();
  } catch (e) { return next(e); }
};

export const validateUpdateMembership = (
  req: Request, _res: Response, next: NextFunction
) => {
  try {
    const { price } = req.body;
    if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0))
      throw new AppError(400, "price must be a non-negative number", "VALIDATION_ERROR");
    validatePricingFields(req.body);
    return next();
  } catch (e) { return next(e); }
};

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