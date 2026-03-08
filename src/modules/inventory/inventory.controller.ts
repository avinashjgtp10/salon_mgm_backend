import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { suppliersService, stockMovementsService, stockTakeService } from "./inventory.service";
import {
    CreateSupplierBody,
    UpdateSupplierBody,
    CreateStockMovementBody,
    StockTakeBody,
    ListStockMovementsFilters,
    MovementType,
} from "./inventory.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersController = {
    // POST /api/v1/inventory/suppliers
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;

            logger.info("POST /inventory/suppliers called", { userId, role, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const supplier = await suppliersService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body as CreateSupplierBody,
            });

            sendSuccess(res, 201, supplier, "Supplier created successfully");
        } catch (err) {
            logger.error("POST /inventory/suppliers error", { err });
            next(err);
        }
    },

    // GET /api/v1/inventory/suppliers
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            logger.info("GET /inventory/suppliers called", {
                requesterUserId: req.user?.userId,
                path: req.originalUrl,
            });

            const suppliers = await suppliersService.listAll();

            sendSuccess(res, 200, suppliers, "Suppliers fetched successfully");
        } catch (err) {
            logger.error("GET /inventory/suppliers error", { err });
            next(err);
        }
    },

    // GET /api/v1/inventory/suppliers/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();

            logger.info("GET /inventory/suppliers/:id called", { supplierId: id, path: req.originalUrl });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const supplier = await suppliersService.getById(id);

            sendSuccess(res, 200, supplier, "Supplier fetched successfully");
        } catch (err) {
            logger.error("GET /inventory/suppliers/:id error", { err });
            next(err);
        }
    },

    // PATCH /api/v1/inventory/suppliers/:id
    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();

            logger.info("PATCH /inventory/suppliers/:id called", {
                supplierId: id,
                requesterUserId: userId,
                requesterRole: role,
                path: req.originalUrl,
            });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const updated = await suppliersService.update({
                supplierId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch: req.body as UpdateSupplierBody,
            });

            sendSuccess(res, 200, updated, "Supplier updated successfully");
        } catch (err) {
            logger.error("PATCH /inventory/suppliers/:id error", { err });
            next(err);
        }
    },

    // DELETE /api/v1/inventory/suppliers/:id
    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();

            logger.info("DELETE /inventory/suppliers/:id called", {
                supplierId: id,
                requesterUserId: userId,
                path: req.originalUrl,
            });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            await suppliersService.delete({ supplierId: id, requesterUserId: userId, requesterRole: role });

            sendSuccess(res, 200, null, "Supplier deleted successfully");
        } catch (err) {
            logger.error("DELETE /inventory/suppliers/:id error", { err });
            next(err);
        }
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsController = {
    // POST /api/v1/inventory/stock-movements
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;

            logger.info("POST /inventory/stock-movements called", { userId, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const movement = await stockMovementsService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body as CreateStockMovementBody,
            });

            sendSuccess(res, 201, movement, "Stock movement created successfully");
        } catch (err) {
            logger.error("POST /inventory/stock-movements error", { err });
            next(err);
        }
    },

    // GET /api/v1/inventory/stock-movements
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            logger.info("GET /inventory/stock-movements called", {
                requesterUserId: req.user?.userId,
                query: req.query,
                path: req.originalUrl,
            });

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

            const result = await stockMovementsService.list(filters);

            sendSuccess(res, 200, result, "Stock movements fetched successfully");
        } catch (err) {
            logger.error("GET /inventory/stock-movements error", { err });
            next(err);
        }
    },

    // GET /api/v1/inventory/stock-movements/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();

            logger.info("GET /inventory/stock-movements/:id called", {
                movementId: id,
                path: req.originalUrl,
            });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const movement = await stockMovementsService.getById(id);

            sendSuccess(res, 200, movement, "Stock movement fetched successfully");
        } catch (err) {
            logger.error("GET /inventory/stock-movements/:id error", { err });
            next(err);
        }
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeController = {
    // POST /api/v1/inventory/stock-take
    async process(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;

            logger.info("POST /inventory/stock-take called", { userId, path: req.originalUrl });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const result = await stockTakeService.process({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body as StockTakeBody,
            });

            sendSuccess(res, 200, result, "Stock take processed successfully");
        } catch (err) {
            logger.error("POST /inventory/stock-take error", { err });
            next(err);
        }
    },
};
