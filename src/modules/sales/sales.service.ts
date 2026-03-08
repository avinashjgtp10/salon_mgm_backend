import { AppError } from "../../middleware/error.middleware";
import { salesRepository } from "./sales.repository";
import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody, CheckoutSaleBody } from "./sales.types";

export const salesService = {
    async create(params: { requesterUserId: string; requesterRole?: string; body: CreateSaleBody }): Promise<{ sale: Sale; items: SaleItem[] }> {
        const { requesterUserId, body } = params;
        const sale = await salesRepository.create(body, requesterUserId);
        const items = await salesRepository.findItemsBySaleId(sale.id);
        return { sale, items };
    },

    async getById(id: string): Promise<{ sale: Sale; items: SaleItem[] }> {
        const sale = await salesRepository.findById(id);
        if (!sale) throw new AppError(404, "Sale not found", "NOT_FOUND");
        const items = await salesRepository.findItemsBySaleId(id);
        return { sale, items };
    },

    async list(filters: { salon_id?: string; client_id?: string; status?: string }): Promise<Sale[]> {
        return salesRepository.list(filters);
    },

    async getDailySummary(salonId: string, date: string): Promise<{ total: string; count: string }> {
        return salesRepository.getDailySummary(salonId, date);
    },

    async update(params: { id: string; requesterUserId: string; requesterRole?: string; patch: UpdateSaleBody }): Promise<Sale> {
        const { id, patch } = params;
        const existing = await salesRepository.findById(id);
        if (!existing) throw new AppError(404, "Sale not found", "NOT_FOUND");
        if (existing.status !== 'draft') throw new AppError(400, "Only draft sales can be updated", "BAD_REQUEST");
        return salesRepository.update(id, patch);
    },

    async checkout(params: { id: string; requesterUserId: string; requesterRole?: string; body: CheckoutSaleBody }): Promise<Sale> {
        const { id, body } = params;
        const existing = await salesRepository.findById(id);
        if (!existing) throw new AppError(404, "Sale not found", "NOT_FOUND");
        if (existing.status !== 'draft') throw new AppError(400, "Only draft sales can be checked out", "BAD_REQUEST");
        return salesRepository.checkout(id, body);
    }
};
