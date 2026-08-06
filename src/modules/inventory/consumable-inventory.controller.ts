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
const VALID_STATUSES: ConsumableStatus[] = ["healthy", "low", "out_of_stock", "deactivated"];
const VALID_PRODUCT_TYPES = ["consumable", "both"] as const;

// Multi-select filters arrive as a single comma-separated query param (e.g.
// ?category_id=uuid1,uuid2) rather than repeated keys — simpler to build on
// the frontend than relying on a particular array query-string convention,
// and just as easy to split back apart here.
function parseCsv(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const list = value.split(",").map((v) => v.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function parseCsvEnum<T extends string>(value: unknown, valid: readonly T[]): T[] | undefined {
  const list = parseCsv(value);
  if (!list) return undefined;
  const filtered = list.filter((v): v is T => (valid as readonly string[]).includes(v));
  return filtered.length ? filtered : undefined;
}

export const consumableInventoryController = {
  // GET /api/v1/inventory/consumables
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const { search, category_id, brand_id, supplier_id, status, unit, service_id, product_type, sort_by, page: pageQuery, limit: limitQuery } = req.query;

      const filters = {
        search: search as string | undefined,
        category_id: parseCsv(category_id),
        brand_id: parseCsv(brand_id),
        supplier_id: parseCsv(supplier_id),
        status: parseCsvEnum(status, VALID_STATUSES),
        unit: parseCsv(unit),
        service_id: parseCsv(service_id),
        product_type: parseCsvEnum(product_type, VALID_PRODUCT_TYPES),
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

  // GET /api/v1/inventory/consumables/:id/assigned-services
  async assignedServices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || "").trim();
      const rows = await consumableInventoryService.getAssignedServices(id, salonId);
      return sendSuccess(res, 200, rows, "Assigned services fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/inventory/consumables/:id/unit-conversions
  async getUnitConversions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || "").trim();
      const rows = await consumableInventoryService.getUnitConversions(id, salonId);
      return sendSuccess(res, 200, rows, "Unit conversions fetched");
    } catch (err) { return next(err); }
  },

  // PUT /api/v1/inventory/consumables/:id/unit-conversions
  async replaceUnitConversions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || "").trim();
      const rows = await consumableInventoryService.replaceUnitConversions(id, salonId, req.body?.unit_conversions);
      return sendSuccess(res, 200, rows, "Unit conversions saved");
    } catch (err) { return next(err); }
  },
};
