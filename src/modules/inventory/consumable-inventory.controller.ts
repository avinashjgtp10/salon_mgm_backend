import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { consumableInventoryService } from "./consumable-inventory.service";
import { AdjustStockBody, ConsumableStatus } from "./consumable-inventory.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

const VALID_SORTS = ["newest", "lowest_stock", "most_used", "a_z"] as const;
const VALID_STATUSES: (ConsumableStatus | "all")[] = ["healthy", "low", "out_of_stock", "all"];

export const consumableInventoryController = {
  // GET /api/v1/inventory/consumables
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const { search, category_id, brand_id, supplier_id, status, unit, service_id, sort_by, page: pageQuery, limit: limitQuery } = req.query;

      const filters = {
        search: search as string | undefined,
        category_id: category_id as string | undefined,
        brand_id: brand_id as string | undefined,
        supplier_id: supplier_id as string | undefined,
        status: VALID_STATUSES.includes(status as any) ? (status as any) : undefined,
        unit: unit as string | undefined,
        service_id: service_id as string | undefined,
        sort_by: VALID_SORTS.includes(sort_by as any) ? (sort_by as any) : undefined,
        page: pageQuery ? parseInt(pageQuery as string, 10) : undefined,
        limit: limitQuery ? parseInt(limitQuery as string, 10) : undefined,
      };

      const page = filters.page ?? 1;
      const pageSize = filters.limit ?? 20;
      const { data, total } = await consumableInventoryService.list(filters, salonId);
      return sendSuccess(res, 200, {
        data, page, pageSize,
        totalRecords: total,
        totalPages: Math.ceil(total / pageSize),
      }, "Consumables fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/inventory/consumables/kpis
  async kpis(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const kpis = await consumableInventoryService.getKpis(salonId);
      return sendSuccess(res, 200, kpis, "Consumable KPIs fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/inventory/consumables/usage-history
  async usageHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const { product_id, service_id, direction, from, to, page, limit } = req.query;
      const filters = {
        product_id: product_id as string | undefined,
        service_id: service_id as string | undefined,
        direction: (direction === "deduct" || direction === "return") ? (direction as "deduct" | "return") : undefined,
        from: from as string | undefined,
        to: to as string | undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      };
      const pageNum = filters.page ?? 1;
      const pageSize = filters.limit ?? 25;
      const { data, total } = await consumableInventoryService.listUsageHistory(filters, salonId);
      return sendSuccess(res, 200, {
        data, page: pageNum, pageSize,
        totalRecords: total,
        totalPages: Math.ceil(total / pageSize),
      }, "Usage history fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/inventory/consumables/:id
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || "").trim();
      const detail = await consumableInventoryService.getById(id, salonId);
      return sendSuccess(res, 200, detail, "Consumable detail fetched");
    } catch (err) { return next(err); }
  },

  // POST /api/v1/inventory/consumables/:id/adjust
  async adjustStock(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const body = req.body as AdjustStockBody;
      if (body.direction !== "increase" && body.direction !== "decrease") {
        throw new AppError(400, "direction must be 'increase' or 'decrease'", "VALIDATION_ERROR");
      }
      const validReasons = ["purchase", "damage", "expired", "manual_correction"];
      if (!validReasons.includes(body.reason)) {
        throw new AppError(400, `reason must be one of: ${validReasons.join(", ")}`, "VALIDATION_ERROR");
      }

      const id = String(req.params.id || "").trim();
      await consumableInventoryService.adjustStock({ productId: id, salonId, userId, body });
      return sendSuccess(res, 200, null, "Stock adjusted");
    } catch (err) { return next(err); }
  },
};
