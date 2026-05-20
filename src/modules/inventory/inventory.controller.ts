import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { suppliersService, stockMovementsService, stocktakesService, stockTakeService } from "./inventory.service";
import {
    CreateSupplierBody,
    UpdateSupplierBody,
    CreateStockMovementBody,
    StockTakeBody,
    ListStockMovementsFilters,
    MovementType,
    CreateStocktakeBody,
} from "./inventory.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);

            logger.info("POST /inventory/suppliers called", { userId, role, salonId, path: req.originalUrl });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const supplier = await suppliersService.create({
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                body: req.body as CreateSupplierBody,
            });

            sendSuccess(res, 201, supplier, "Supplier created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await getSalonId(req);
            logger.info("GET /inventory/suppliers called", { requesterUserId: req.user?.userId, salonId, path: req.originalUrl });

            const suppliers = await suppliersService.listAll(salonId);
            sendSuccess(res, 200, suppliers, "Suppliers fetched successfully");
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            const salonId = await getSalonId(req);
            logger.info("GET /inventory/suppliers/:id called", { supplierId: id, salonId, path: req.originalUrl });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const supplier = await suppliersService.getById(id, salonId);
            sendSuccess(res, 200, supplier, "Supplier fetched successfully");
        } catch (err) { next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);
            const id = String(req.params.id || "").trim();

            logger.info("PATCH /inventory/suppliers/:id called", { supplierId: id, requesterUserId: userId, requesterRole: role, salonId, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const updated = await suppliersService.update({
                supplierId: id,
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                patch: req.body as UpdateSupplierBody,
            });

            sendSuccess(res, 200, updated, "Supplier updated successfully");
        } catch (err) { next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);
            const id = String(req.params.id || "").trim();

            logger.info("DELETE /inventory/suppliers/:id called", { supplierId: id, requesterUserId: userId, salonId, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            await suppliersService.delete({ supplierId: id, requesterUserId: userId, requesterRole: role, salonId });
            sendSuccess(res, 200, null, "Supplier deleted successfully");
        } catch (err) { next(err); }
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);

            logger.info("POST /inventory/stock-movements called", { userId, salonId, path: req.originalUrl });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const movement = await stockMovementsService.create({
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                body: req.body as CreateStockMovementBody,
            });

            sendSuccess(res, 201, movement, "Stock movement created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await getSalonId(req);
            logger.info("GET /inventory/stock-movements called", { requesterUserId: req.user?.userId, salonId, query: req.query, path: req.originalUrl });

            const filters: ListStockMovementsFilters = {
                product_id: req.query.product_id as string | undefined,
                branch_id: req.query.branch_id as string | undefined,
                supplier_id: req.query.supplier_id as string | undefined,
                movement_type: req.query.movement_type as MovementType | undefined,
                from_date: req.query.from_date as string | undefined,
                to_date: req.query.to_date as string | undefined,
                page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
            };

            const result = await stockMovementsService.list(filters, salonId);
            sendSuccess(res, 200, result, "Stock movements fetched successfully");
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            const salonId = await getSalonId(req);
            logger.info("GET /inventory/stock-movements/:id called", { movementId: id, salonId, path: req.originalUrl });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const movement = await stockMovementsService.getById(id, salonId);
            sendSuccess(res, 200, movement, "Stock movement fetched successfully");
        } catch (err) { next(err); }
    },
};

// ─── Stock Takes ──────────────────────────────────────────────────────────────

export const stocktakesController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);
            logger.info("POST /inventory/stock-takes called", { userId, role, salonId, path: req.originalUrl });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const stocktake = await stocktakesService.create({
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                body: req.body as CreateStocktakeBody,
            });

            sendSuccess(res, 201, stocktake, "Stocktake event created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await getSalonId(req);
            const branchId = String(req.query.branch_id || "");
            if (!branchId) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");

            logger.info("GET /inventory/stock-takes called", { branchId, salonId, path: req.originalUrl });

            const stocktakes = await stocktakesService.list(branchId, salonId);
            sendSuccess(res, 200, stocktakes, "Stocktakes fetched successfully");
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await getSalonId(req);
            const id = String(req.params.id || "");
            logger.info("GET /inventory/stock-takes/:id called", { id, salonId, path: req.originalUrl });

            const stocktake = await stocktakesService.getById(id, salonId);
            sendSuccess(res, 200, stocktake, "Stocktake fetched successfully");
        } catch (err) { next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await getSalonId(req);
            const id = String(req.params.id || "");
            const userId = req.user?.userId;

            logger.info("DELETE /inventory/stock-takes/:id called", { id, userId, salonId, path: req.originalUrl });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            await stocktakesService.delete(id, salonId);
            sendSuccess(res, 200, null, "Stocktake deleted successfully");
        } catch (err) { next(err); }
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeController = {
    async process(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = await getSalonId(req);

            logger.info("POST /inventory/stock-take called", { userId, salonId, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const result = await stockTakeService.process({
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                body: req.body as StockTakeBody,
            });

            sendSuccess(res, 200, result, "Stock take processed successfully");
        } catch (err) { next(err); }
    },
};

