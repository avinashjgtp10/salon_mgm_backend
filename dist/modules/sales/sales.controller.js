"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salesController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const sales_service_1 = require("./sales.service");
exports.salesController = {
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const result = await sales_service_1.salesService.create({
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, result, "Sale created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const id = req.params.id;
            const result = await sales_service_1.salesService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Sale fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async list(req, res, next) {
        try {
            const sales = await sales_service_1.salesService.list({
                salon_id: req.query.salon_id,
                client_id: req.query.client_id,
                status: req.query.status,
            });
            return (0, response_util_1.sendSuccess)(res, 200, sales, "Sales fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async getDailySummary(req, res, next) {
        try {
            const { salon_id, date } = req.query;
            if (!salon_id || !date)
                throw new error_middleware_1.AppError(400, "salon_id and date query parameters are required", "VALIDATION_ERROR");
            const summary = await sales_service_1.salesService.getDailySummary(salon_id, date);
            return (0, response_util_1.sendSuccess)(res, 200, summary, "Daily summary fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = req.params.id;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const sale = await sales_service_1.salesService.update({
                id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, sale, "Sale updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async checkout(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = req.params.id;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const sale = await sales_service_1.salesService.checkout({
                id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, sale, "Sale checked out successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async exportSales(req, res, next) {
        try {
            const rawFormat = req.query.format;
            const format = rawFormat === "pdf" ? "pdf" : rawFormat === "excel" ? "excel" : "csv";
            const { buffer, contentType, filename } = await sales_service_1.salesService.exportSales({
                salon_id: req.query.salon_id,
                status: req.query.status,
                date: req.query.date,
                format,
            });
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", contentType);
            return res.send(buffer);
        }
        catch (err) {
            return next(err);
        }
    }
};
//# sourceMappingURL=sales.controller.js.map