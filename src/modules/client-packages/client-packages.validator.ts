import { Request, Response, NextFunction } from "express";

function badRequest(res: Response, message: string) {
  return res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message },
  });
}

export function validateCreateClientPackage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { clientId, packageName, basePrice, paymentMethod, services } = req.body;

  if (!clientId)                          return badRequest(res, "clientId is required");
  if (!packageName?.trim())               return badRequest(res, "packageName is required");
  if (typeof basePrice !== "number" || basePrice < 0)
                                          return badRequest(res, "basePrice must be a non-negative number");
  if (!paymentMethod?.trim())             return badRequest(res, "paymentMethod is required");
  if (!Array.isArray(services) || services.length === 0)
                                          return badRequest(res, "At least one service is required");

  for (const svc of services) {
    if (!svc.serviceName?.trim())         return badRequest(res, "Each service must have a serviceName");
    if (!Number.isInteger(svc.totalSessions) || svc.totalSessions < 1)
                                          return badRequest(res, "Each service must have totalSessions >= 1");
    if (typeof svc.price !== "number" || svc.price < 0)
                                          return badRequest(res, "Each service must have a non-negative price");
  }

  return next();
}

export function validateCompleteSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { serviceId, staffName } = req.body;
  if (!serviceId?.trim())  return badRequest(res, "serviceId is required");
  if (!staffName?.trim())  return badRequest(res, "staffName is required");
  return next();
}
