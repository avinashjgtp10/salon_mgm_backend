import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const parseSessionCount = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  const match = value.trim().match(/\d+/);
  if (!match) return undefined;

  const parsed = Number(match[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const validateSessionInput = (body: Record<string, unknown>) => {
  const sessionType = typeof body.sessionType === "string"
    ? body.sessionType.trim().toLowerCase()
    : undefined;
  const sessions = body.sessions;
  const numberOfSessions = body.numberOfSessions;
  const parsedCount = parseSessionCount(numberOfSessions) ?? parseSessionCount(sessions);

  if (sessionType === "limited" && parsedCount === undefined) {
    throw new AppError(
      400,
      "numberOfSessions or sessions is required for limited memberships",
      "VALIDATION_ERROR"
    );
  }
};

export const validateCreateMembership = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const {
      name,
      price,
      sessionType,
      validFor,
      colour,
      enableOnlineSales,
      enableOnlineRedemption,
      includedServices,
    } = req.body;

    if (!name || typeof name !== "string") {
      throw new AppError(400, "name is required", "VALIDATION_ERROR");
    }
    if (!Array.isArray(includedServices)) {
      throw new AppError(400, "includedServices must be an array", "VALIDATION_ERROR");
    }
    if (price === undefined || isNaN(Number(price))) {
      throw new AppError(400, "price is required and must be a number", "VALIDATION_ERROR");
    }
    if (!sessionType) {
      throw new AppError(400, "sessionType is required", "VALIDATION_ERROR");
    }
    if (!validFor) {
      throw new AppError(400, "validFor is required", "VALIDATION_ERROR");
    }
    if (!colour) {
      throw new AppError(400, "colour is required", "VALIDATION_ERROR");
    }
    if (enableOnlineSales === undefined) {
      throw new AppError(400, "enableOnlineSales is required", "VALIDATION_ERROR");
    }
    if (enableOnlineRedemption === undefined) {
      throw new AppError(400, "enableOnlineRedemption is required", "VALIDATION_ERROR");
    }

    validateSessionInput(req.body as Record<string, unknown>);
    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateUpdateMembership = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    validateSessionInput(req.body as Record<string, unknown>);
    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateMembershipsListQuery = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const { page, limit, numberOfSessions, onlyAllServices } = req.query;
    if (page && isNaN(Number(page))) {
      throw new AppError(400, "page must be a number", "VALIDATION_ERROR");
    }
    if (limit && isNaN(Number(limit))) {
      throw new AppError(400, "limit must be a number", "VALIDATION_ERROR");
    }
    if (numberOfSessions !== undefined) {
      const parsed = Number(numberOfSessions);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AppError(400, "numberOfSessions must be a positive integer", "VALIDATION_ERROR");
      }
    }
    if (
      onlyAllServices !== undefined &&
      !["true", "false"].includes(String(onlyAllServices).trim().toLowerCase())
    ) {
      throw new AppError(400, "onlyAllServices must be true or false", "VALIDATION_ERROR");
    }
    return next();
  } catch (e) {
    return next(e);
  }
};

export const validateExportQuery = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => next();
