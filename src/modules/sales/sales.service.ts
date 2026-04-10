import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
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

    async exportSales(filters: {
        salon_id?: string;
        status?: string;
        date?: string;
        format: "csv" | "excel" | "pdf";
    }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
        const sales = await salesRepository.exportList({
            salon_id: filters.salon_id,
            status: filters.status,
            date: filters.date,
        });

        const dateLabel = filters.date ?? "all";
        const headers = ["ID", "Status", "Client ID", "Subtotal", "Discount", "Tip", "Tax", "Total", "Payment Method", "Created At"];
        const rows = sales.map(s => [
            s.id, s.status, s.client_id ?? "Walk-in",
            s.subtotal, s.discount_amount, s.tip_amount, s.tax_amount, s.total_amount,
            s.payment_method ?? "", new Date(s.created_at).toLocaleDateString("en-GB"),
        ]);

        // ── CSV ──────────────────────────────────────────────────────────────
        if (filters.format === "csv") {
            const csvLines = [headers.join(","), ...rows.map(r => r.join(","))];
            return {
                buffer: Buffer.from(csvLines.join("\n"), "utf-8"),
                contentType: "text/csv",
                filename: `sales_${dateLabel}.csv`,
            };
        }

        // ── Excel ─────────────────────────────────────────────────────────────
        if (filters.format === "excel") {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Sales");
            sheet.addRow(headers).font = { bold: true };
            rows.forEach(r => sheet.addRow(r));
            sheet.columns.forEach(col => { col.width = 18; });

            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
            return {
                buffer,
                contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename: `sales_${dateLabel}.xlsx`,
            };
        }

        // ── PDF ───────────────────────────────────────────────────────────────
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: "A4", layout: "landscape" });
            const chunks: Buffer[] = [];

            doc.on("data", (chunk: Buffer) => chunks.push(chunk));
            doc.on("end", () => resolve({
                buffer: Buffer.concat(chunks),
                contentType: "application/pdf",
                filename: `sales_${dateLabel}.pdf`,
            }));
            doc.on("error", reject);

            // Title
            doc.fontSize(18).font("Helvetica-Bold")
                .text("Daily Sales Report", { align: "center" });
            doc.fontSize(11).font("Helvetica")
                .text(`Date: ${filters.date ?? "All"}`, { align: "center" });
            doc.moveDown(1.5);

            // Column widths
            const colWidths = [60, 70, 100, 60, 60, 40, 40, 60, 90, 90];
            const startX = 50;
            const rowHeight = 20;
            let y = doc.y;

            const drawRow = (cells: string[], isHeader = false) => {
                let x = startX;
                if (isHeader) {
                    doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#333333");
                    doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
                } else {
                    doc.fillColor("black").font("Helvetica").fontSize(8);
                }
                cells.forEach((cell, i) => {
                    doc.text(String(cell), x + 3, y + 5, { width: colWidths[i] - 6, ellipsis: true, lineBreak: false });
                    x += colWidths[i];
                });
                y += rowHeight;
            };

            drawRow(headers, true);

            rows.forEach((row, idx) => {
                if (idx % 2 === 0) {
                    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#f5f5f5");
                }
                drawRow(row.map(String));
            });

            if (rows.length === 0) {
                doc.fillColor("#999999").font("Helvetica").fontSize(10)
                    .text("No sales records found for this date.", startX, y + 10, { align: "center" });
            }

            doc.end();
        });
    }
};
