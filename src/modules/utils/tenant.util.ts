import { Request } from "express";
import { AppError } from "../../middleware/error.middleware";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const tenantFilter = (req: AuthRequest, extraFilter: Record<string, any> = {}): Record<string, any> => ({
  salonId: getSalonId(req),
  ...extraFilter,
});
