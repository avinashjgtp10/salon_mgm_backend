import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { CONSUMABLE_USAGE_SORT_FIELDS } from "./consumables.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STOCK_STATUSES = new Set(["healthy", "low_stock", "out_of_stock"]);

const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

export const validateConsumableUsage = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const filters = body.filters ?? {};
    const sort = body.sort ?? { field: "product_name", direction: "asc" };

    if (typeof body.salon_id !== "string" || !UUID_RE.test(body.salon_id))
      throw new AppError(400, "salon_id must be a valid UUID", "VALIDATION_ERROR");
    if (!Number.isInteger(body.page) || body.page < 1)
      throw new AppError(400, "page must be a positive integer", "VALIDATION_ERROR");
    if (!Number.isInteger(body.pageSize) || body.pageSize < 1 || body.pageSize > 200)
      throw new AppError(400, "pageSize must be an integer between 1 and 200", "VALIDATION_ERROR");
    if (body.search !== undefined && typeof body.search !== "string")
      throw new AppError(400, "search must be a string", "VALIDATION_ERROR");
    if (body.filters !== undefined && (typeof body.filters !== "object" || Array.isArray(body.filters) || body.filters === null))
      throw new AppError(400, "filters must be an object", "VALIDATION_ERROR");
    for (const field of ["category_id", "service_id"] as const) {
      if (filters[field] != null && (typeof filters[field] !== "string" || !UUID_RE.test(filters[field])))
        throw new AppError(400, `${field} must be a valid UUID`, "VALIDATION_ERROR");
    }
    if (filters.unit != null && (typeof filters.unit !== "string" || !filters.unit.trim()))
      throw new AppError(400, "unit must be a non-empty string", "VALIDATION_ERROR");
    if (filters.stock_status != null && !STOCK_STATUSES.has(filters.stock_status))
      throw new AppError(400, "stock_status must be healthy, low_stock, or out_of_stock", "VALIDATION_ERROR");
    for (const field of ["date_from", "date_to"] as const) {
      if (filters[field] != null && !validDate(filters[field]))
        throw new AppError(400, `${field} must use YYYY-MM-DD format`, "VALIDATION_ERROR");
    }
    if (filters.date_from && filters.date_to && filters.date_from > filters.date_to)
      throw new AppError(400, "date_from cannot be after date_to", "VALIDATION_ERROR");
    if (!sort || typeof sort !== "object" || !CONSUMABLE_USAGE_SORT_FIELDS.includes(sort.field))
      throw new AppError(400, `sort.field must be one of: ${CONSUMABLE_USAGE_SORT_FIELDS.join(", ")}`, "VALIDATION_ERROR");
    if (!['asc', 'desc'].includes(sort.direction))
      throw new AppError(400, "sort.direction must be asc or desc", "VALIDATION_ERROR");

    body.search = body.search?.trim() ?? "";
    body.filters = filters;
    body.sort = sort;
    return next();
  } catch (error) { return next(error); }
};
