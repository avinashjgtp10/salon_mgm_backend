"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockTakeController = exports.stockMovementsController = exports.suppliersController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const inventory_service_1 = require("./inventory.service");
// ─── Suppliers ────────────────────────────────────────────────────────────────
exports.suppliersController = {
    // POST /api/v1/inventory/suppliers
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /inventory/suppliers called", { userId, role, path: req.originalUrl });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const supplier = await inventory_service_1.suppliersService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 201, supplier, "Supplier created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /inventory/suppliers error", { err });
            next(err);
        }
    },
    // GET /api/v1/inventory/suppliers
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /inventory/suppliers called", {
                requesterUserId: req.user?.userId,
                path: req.originalUrl,
            });
            const suppliers = await inventory_service_1.suppliersService.listAll();
            (0, response_util_1.sendSuccess)(res, 200, suppliers, "Suppliers fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /inventory/suppliers error", { err });
            next(err);
        }
    },
    // GET /api/v1/inventory/suppliers/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /inventory/suppliers/:id called", { supplierId: id, path: req.originalUrl });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const supplier = await inventory_service_1.suppliersService.getById(id);
            (0, response_util_1.sendSuccess)(res, 200, supplier, "Supplier fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /inventory/suppliers/:id error", { err });
            next(err);
        }
    },
    // PATCH /api/v1/inventory/suppliers/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /inventory/suppliers/:id called", {
                supplierId: id,
                requesterUserId: userId,
                requesterRole: role,
                path: req.originalUrl,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await inventory_service_1.suppliersService.update({
                supplierId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, updated, "Supplier updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /inventory/suppliers/:id error", { err });
            next(err);
        }
    },
    // DELETE /api/v1/inventory/suppliers/:id
    async delete(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("DELETE /inventory/suppliers/:id called", {
                supplierId: id,
                requesterUserId: userId,
                path: req.originalUrl,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await inventory_service_1.suppliersService.delete({ supplierId: id, requesterUserId: userId, requesterRole: role });
            (0, response_util_1.sendSuccess)(res, 200, null, "Supplier deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /inventory/suppliers/:id error", { err });
            next(err);
        }
    },
};
// ─── Stock Movements ──────────────────────────────────────────────────────────
exports.stockMovementsController = {
    // POST /api/v1/inventory/stock-movements
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /inventory/stock-movements called", { userId, path: req.originalUrl });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const movement = await inventory_service_1.stockMovementsService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 201, movement, "Stock movement created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /inventory/stock-movements error", { err });
            next(err);
        }
    },
    // GET /api/v1/inventory/stock-movements
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /inventory/stock-movements called", {
                requesterUserId: req.user?.userId,
                query: req.query,
                path: req.originalUrl,
            });
            const filters = {
                product_id: req.query.product_id,
                branch_id: req.query.branch_id,
                supplier_id: req.query.supplier_id,
                movement_type: req.query.movement_type,
                from_date: req.query.from_date,
                to_date: req.query.to_date,
                page: req.query.page ? parseInt(req.query.page, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
            };
            const result = await inventory_service_1.stockMovementsService.list(filters);
            (0, response_util_1.sendSuccess)(res, 200, result, "Stock movements fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /inventory/stock-movements error", { err });
            next(err);
        }
    },
    // GET /api/v1/inventory/stock-movements/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /inventory/stock-movements/:id called", {
                movementId: id,
                path: req.originalUrl,
            });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const movement = await inventory_service_1.stockMovementsService.getById(id);
            (0, response_util_1.sendSuccess)(res, 200, movement, "Stock movement fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /inventory/stock-movements/:id error", { err });
            next(err);
        }
    },
};
// ─── Stock Take ───────────────────────────────────────────────────────────────
exports.stockTakeController = {
    // POST /api/v1/inventory/stock-take
    async process(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /inventory/stock-take called", { userId, path: req.originalUrl });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const result = await inventory_service_1.stockTakeService.process({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, result, "Stock take processed successfully");
        }
        catch (err) {
            logger_1.default.error("POST /inventory/stock-take error", { err });
            next(err);
        }
    },
};
//# sourceMappingURL=inventory.controller.js.map