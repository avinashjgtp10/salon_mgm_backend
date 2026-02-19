import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isOptionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";

export const validateCreateCategory = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isNonEmptyString(b.name)) throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isOptionalString(b.description)) throw new AppError(400, "description must be string", "VALIDATION_ERROR");
    if (b.display_order !== undefined && typeof b.display_order !== "number") {
      throw new AppError(400, "display_order must be number", "VALIDATION_ERROR");
    }
    if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateUpdateCategory = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (b.name !== undefined && !isNonEmptyString(b.name)) {
      throw new AppError(400, "name must be non-empty string", "VALIDATION_ERROR");
    }
    if (!isOptionalString(b.description)) throw new AppError(400, "description must be string", "VALIDATION_ERROR");
    if (b.display_order !== undefined && typeof b.display_order !== "number") {
      throw new AppError(400, "display_order must be number", "VALIDATION_ERROR");
    }
    if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateCreateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isNonEmptyString(b.name)) throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isOptionalString(b.description)) throw new AppError(400, "description must be string", "VALIDATION_ERROR");

    if (typeof b.duration_minutes !== "number" || b.duration_minutes <= 0) {
      throw new AppError(400, "duration_minutes must be positive number", "VALIDATION_ERROR");
    }

    if (typeof b.price !== "number" || b.price < 0) {
      throw new AppError(400, "price must be number >= 0", "VALIDATION_ERROR");
    }

    if (b.discounted_price !== undefined && b.discounted_price !== null && typeof b.discounted_price !== "number") {
      throw new AppError(400, "discounted_price must be number or null", "VALIDATION_ERROR");
    }

    if (b.gender_preference !== undefined && b.gender_preference !== null) {
      const gp = String(b.gender_preference);
      if (!["male", "female", "unisex"].includes(gp)) {
        throw new AppError(400, "gender_preference must be male/female/unisex", "VALIDATION_ERROR");
      }
    }

    if (!isOptionalString(b.image_url)) throw new AppError(400, "image_url must be string", "VALIDATION_ERROR");
    if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

    if (b.category_id !== undefined && b.category_id !== null && typeof b.category_id !== "string") {
      throw new AppError(400, "category_id must be string or null", "VALIDATION_ERROR");
    }

    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateUpdateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (b.name !== undefined && !isNonEmptyString(b.name)) {
      throw new AppError(400, "name must be non-empty string", "VALIDATION_ERROR");
    }
    if (!isOptionalString(b.description)) throw new AppError(400, "description must be string", "VALIDATION_ERROR");

    if (b.duration_minutes !== undefined && (typeof b.duration_minutes !== "number" || b.duration_minutes <= 0)) {
      throw new AppError(400, "duration_minutes must be positive number", "VALIDATION_ERROR");
    }

    if (b.price !== undefined && (typeof b.price !== "number" || b.price < 0)) {
      throw new AppError(400, "price must be number >= 0", "VALIDATION_ERROR");
    }

    if (b.discounted_price !== undefined && b.discounted_price !== null && typeof b.discounted_price !== "number") {
      throw new AppError(400, "discounted_price must be number or null", "VALIDATION_ERROR");
    }

    if (b.gender_preference !== undefined && b.gender_preference !== null) {
      const gp = String(b.gender_preference);
      if (!["male", "female", "unisex"].includes(gp)) {
        throw new AppError(400, "gender_preference must be male/female/unisex", "VALIDATION_ERROR");
      }
    }

    if (!isOptionalString(b.image_url)) throw new AppError(400, "image_url must be string", "VALIDATION_ERROR");
    if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

    if (b.category_id !== undefined && b.category_id !== null && typeof b.category_id !== "string") {
      throw new AppError(400, "category_id must be string or null", "VALIDATION_ERROR");
    }

    return next();
  } catch (e) {
    return next(e);
  }
};
