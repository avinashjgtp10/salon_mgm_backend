import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const validateStaffAvailability = (req: Request, _res: Response, next: NextFunction) => {
  const staffId = String(req.params.staffId ?? "");
  const date = String(req.query.date ?? "");
  const serviceId = req.query.serviceId === undefined ? undefined : String(req.query.serviceId);
  const branchId = req.query.branchId === undefined ? undefined : String(req.query.branchId);

console.log("Original URL:", req.originalUrl);
console.log("Query:", req.query);
console.log("Raw date:", req.query.date);

  if (!UUID_RE.test(staffId)) throw new AppError(400, "staffId must be a valid UUID", "VALIDATION_ERROR");
  if (!DATE_RE.test(date)) throw new AppError(400, "date must use YYYY-MM-DD format", "VALIDATION_ERROR");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, "date is invalid", "VALIDATION_ERROR");
  }
  if (serviceId !== undefined && !UUID_RE.test(serviceId)) {
    throw new AppError(400, "serviceId must be a valid UUID", "VALIDATION_ERROR");
  }
  if (branchId !== undefined && !UUID_RE.test(branchId)) {
    throw new AppError(400, "branchId must be a valid UUID", "VALIDATION_ERROR");
  }

  return next();
};
