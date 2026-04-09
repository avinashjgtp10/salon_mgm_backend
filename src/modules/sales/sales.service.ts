import ExcelJS from "exceljs";
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
    },

    async exportSales(filters: { salon_id?: string; status?: string; format: "csv" | "excel" }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
        const sales = await salesRepository.exportList({ salon_id: filters.salon_id, status: filters.status });

        const headers = ["ID", "Status", "Client ID", "Subtotal", "Discount", "Tip", "Tax", "Total", "Payment Method", "Created At"];
        const rows = sales.map(s => [
            s.id, s.status, s.client_id ?? "Walk-in",
            s.subtotal, s.discount_amount, s.tip_amount, s.tax_amount, s.total_amount,
            s.payment_method ?? "", new Date(s.created_at).toLocaleDateString("en-GB"),
        ]);

        if (filters.format === "csv") {
            const csvLines = [headers.join(","), ...rows.map(r => r.join(","))];
            return {
                buffer: Buffer.from(csvLines.join("\n"), "utf-8"),
                contentType: "text/csv",
                filename: "sales.csv",
            };
        }

        // Excel via ExcelJS
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Sales");
        sheet.addRow(headers).font = { bold: true };
        rows.forEach(r => sheet.addRow(r));
        sheet.columns.forEach(col => { col.width = 18; });

        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
        return {
            buffer,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "sales.xlsx",
        };
    }
};
