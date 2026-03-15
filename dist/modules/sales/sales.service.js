"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salesService = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const sales_repository_1 = require("./sales.repository");
exports.salesService = {
    async create(params) {
        const { requesterUserId, body } = params;
        const sale = await sales_repository_1.salesRepository.create(body, requesterUserId);
        const items = await sales_repository_1.salesRepository.findItemsBySaleId(sale.id);
        return { sale, items };
    },
    async getById(id) {
        const sale = await sales_repository_1.salesRepository.findById(id);
        if (!sale)
            throw new error_middleware_1.AppError(404, "Sale not found", "NOT_FOUND");
        const items = await sales_repository_1.salesRepository.findItemsBySaleId(id);
        return { sale, items };
    },
    async list(filters) {
        return sales_repository_1.salesRepository.list(filters);
    },
    async getDailySummary(salonId, date) {
        return sales_repository_1.salesRepository.getDailySummary(salonId, date);
    },
    async update(params) {
        const { id, patch } = params;
        const existing = await sales_repository_1.salesRepository.findById(id);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Sale not found", "NOT_FOUND");
        if (existing.status !== 'draft')
            throw new error_middleware_1.AppError(400, "Only draft sales can be updated", "BAD_REQUEST");
        return sales_repository_1.salesRepository.update(id, patch);
    },
    async checkout(params) {
        const { id, body } = params;
        const existing = await sales_repository_1.salesRepository.findById(id);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Sale not found", "NOT_FOUND");
        if (existing.status !== 'draft')
            throw new error_middleware_1.AppError(400, "Only draft sales can be checked out", "BAD_REQUEST");
        return sales_repository_1.salesRepository.checkout(id, body);
    }
};
//# sourceMappingURL=sales.service.js.map