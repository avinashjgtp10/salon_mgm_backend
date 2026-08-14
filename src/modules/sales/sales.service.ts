import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { AppError } from "../../middleware/error.middleware";
import logger from "../../config/logger";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { salesRepository } from "./sales.repository";
import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody, CheckoutSaleBody } from "./sales.types";
import { paymentsRepository } from "../payments/payments.repository";
import { appointmentsRepository } from "../appointments/appointments.repository";
import { staffRepository } from "../staff/staff.repository";
import { servicesRepository } from "../services/services.repository";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { notificationsService } from "../notifications/notifications.service";
import { membershipsRepository } from "../memberships/memberships.repository";
import { clientMembershipsService } from "../client-memberships/client-memberships.service";
import { sendPurchaseReceipt } from "./receipt-send.helper";
import { notifyAppointmentCompleted } from "../appointments/appointment-completed.helper";
import { clientPackagesService } from "../client-packages/client-packages.service";

export const salesService = {

    async init(salonId: string): Promise<{ staff: any[]; services: any[] }> {
        const [staffResult, services] = await Promise.all([
            staffRepository.list(salonId, { limit: 500, is_active: true }),
            servicesRepository.listAll({ status: "active" }, salonId),
        ]);
        return { staff: staffResult.data, services };
    },

    async create(params: { requesterUserId: string; requesterRole?: string; body: CreateSaleBody }): Promise<{ sale: Sale; items: SaleItem[] }> {
        const { requesterUserId, body } = params;
        const rawSale = await salesRepository.create(body, requesterUserId);

        // Fetch enriched sale (with client_phone, client_phone_code, salon_name)
        const sale  = (await salesRepository.findById(rawSale.id)) ?? rawSale;
        const items = await salesRepository.findItemsBySaleId(sale.id);

        // Fire notification (fire-and-forget)
        notificationsService.create({
            salon_id: sale.salon_id,
            type:     "payment",
            title:    "New Sale Created",
            body:     `${(sale as any).client_name ?? "Walk-in"} — ₹${sale.total_amount ?? 0}`,
            event_key: "newPayment",
        }).catch((err: any) => {
            logger.error("New sale notification failed", {
                saleId: sale.id,
                salonId: sale.salon_id,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

        // ── WhatsApp Automation: Invoice Generated ────────────────────────────
        // Only fire when there's a real client (not walk-in) and it's a proper sale
        if (sale.client_id && (sale as any).client_phone) {
            whatsappAutomationService.trigger({
                salonId:       sale.salon_id,
                eventType:     "invoice_generated",
                clientId:      sale.client_id,
                phone:         (sale as any).client_phone,
                countryCode:   (sale as any).client_phone_code ?? null,
                variables: {
                    "1": (sale as any).client_name  ?? "Valued Customer",
                    "2": sale.invoice_number ?? "",
                    "3": String(sale.total_amount   ?? "0"),
                    "4": (sale as any).salon_name   ?? "our salon",
                },
                referenceId:   sale.id,
                referenceType: "invoice",
                dedupeByReference: true,
            }).catch(() => {});
        }

        return { sale, items };
    },

    async getById(id: string): Promise<{ sale: Sale; items: SaleItem[] }> {
        const sale = await salesRepository.findById(id);
        if (!sale) throw new AppError(404, "Sale not found", "NOT_FOUND");
        const items = await salesRepository.findItemsBySaleId(id);
        return { sale, items };
    },

    async list(filters: {
        salon_id?: string; client_id?: string; status?: string; staff_id?: string;
        start_date?: string; end_date?: string; page?: number; limit?: number;
    }) {
        return salesRepository.list(filters);
    },

    async listItemsByStaff(
        salonId: string,
        staffId: string,
        filters: { item_type?: string; start_date?: string; end_date?: string; page?: number; limit?: number } = {}
    ) {
        return salesRepository.listItemsByStaff(salonId, staffId, filters);
    },

    async getDailySummary(salonId: string, date?: string): Promise<{ total: string; count: string }> {
        return salesRepository.getDailySummary(salonId, date);
    },

    async delete(id: string): Promise<Sale> {
        const existing = await salesRepository.findById(id);
        if (!existing) throw new AppError(404, "Sale not found", "NOT_FOUND");
        const deleted = await salesRepository.deleteById(id);
        if (!deleted) throw new AppError(500, "Failed to delete sale", "INTERNAL_ERROR");
        logger.info("salesService.delete success", { saleId: id });
        return deleted;
    },

    async update(params: { id: string; requesterUserId: string; requesterRole?: string; patch: UpdateSaleBody }): Promise<{ sale: Sale; items: SaleItem[] }> {
        const { id, patch } = params;
        const existing = await salesRepository.findById(id);
        if (!existing) throw new AppError(404, "Sale not found", "NOT_FOUND");
        const sale = await salesRepository.update(id, patch);
        const updatedItems = await salesRepository.findItemsBySaleId(id);

        // Reverse pending commissions when a sale is cancelled or refunded
        if (patch.status && ["cancelled", "refunded"].includes(patch.status)) {
            commissionCalculationService.reverseForSale(id).catch(() => {});
        }

        return { sale, items: updatedItems };
    },

    async checkout(params: { id: string; requesterUserId: string; requesterRole?: string; body: CheckoutSaleBody }): Promise<Sale> {
        const { id, body } = params;
        const existing = await salesRepository.findById(id);
        if (!existing) throw new AppError(404, "Sale not found", "NOT_FOUND");
        if (existing.status !== "draft") throw new AppError(400, "Only draft sales can be checked out", "BAD_REQUEST");

        const rawSale = await salesRepository.checkout(id, {
            payment_method:    body.payment_method,
            payment_reference: body.payment_reference,
            status:            "completed",
        });

        // Fetch enriched sale (with client_phone, client_phone_code, salon_name)
        const sale  = (await salesRepository.findById(rawSale.id)) ?? rawSale;
        const items = await salesRepository.findItemsBySaleId(sale.id);

        let splitDetails: Record<string, number> | undefined = undefined;
        if (body.payment_method === "split" && body.payment_reference) {
            try {
                splitDetails = JSON.parse(body.payment_reference);
            } catch (e) {}
        }

        const saleDueAmount = Math.max(0, parseFloat(sale.total_amount) - body.amount_paid);

        try {
            await paymentsRepository.create({
                salon_id:       sale.salon_id,
                client_id:      sale.client_id      || undefined,
                appointment_id: sale.appointment_id || undefined,
                gross_amount:   parseFloat(sale.subtotal) || parseFloat(sale.total_amount),
                discount_amount: parseFloat(sale.discount_amount),
                net_amount:     parseFloat(sale.total_amount),
                paid_amount:    body.amount_paid,
                due_amount:     saleDueAmount,
                payment_method: body.payment_method,
                split_details:  splitDetails,
                // Was hardcoded 'completed' regardless of amount collected — a
                // Quick Sale checkout that only took a deposit (amount_paid <
                // total) recorded a payment claiming to be fully settled with a
                // nonzero due_amount still attached, which is self-contradictory
                // and undercounts what's actually still owed everywhere that
                // reads payments.status (e.g. Pending Payments). Same rule the
                // calendar checkout flow already uses.
                status:         saleDueAmount > 0 ? "partial" : "completed",
                notes:          `Payment for Sale ID: ${sale.id}`,
            });
        } catch (error) {
            logger.error("Failed to create payment record for sale:", { saleId: sale.id, salonId: sale.salon_id, error })
        }

        // Mark the linked appointment paid/partial based on whether this checkout
        // actually covered the full bill — a deposit-only checkout (amount_paid <
        // total) must not read as fully paid everywhere else (reports, client
        // history, dashboard) that now key off appointments.status directly.
        if (sale.appointment_id) {
            try {
                const apptStatus = saleDueAmount > 0 ? "partial" : "paid";
                await appointmentsRepository.updateStatus(sale.appointment_id, apptStatus);
                // Only a fully-paid checkout should trigger the thank-you/review-request message.
                if (apptStatus === "paid") {
                    notifyAppointmentCompleted(sale.appointment_id).catch(() => {});
                }
            } catch (error) {
                logger.error("Failed to update appointment status after checkout:", { appointmentId: sale.appointment_id, error })
            }

            // ── Package redemption: this appointment may have been booked from a
            // package sale's schedule-at-purchase flow — deduct the one session it
            // was reserved for now that it's actually complete. No-op for any
            // appointment not created that way (see redeemForAppointmentIfScheduled).
            // appointments.service.ts's own checkout() already does this for its
            // two paths; this one — checkout initiated from the Sales/Quick Sale
            // side — was missing it entirely, so a package service completed this
            // way never consumed its session. Never blocks checkout on failure.
            await clientPackagesService
                .redeemForAppointmentIfScheduled(sale.salon_id, sale.appointment_id, "Staff")
                .catch((err: any) => logger.error("[client-packages] redemption on checkout failed:", err?.message ?? err));
        }

        // ── Commission Calculation (fire-and-forget — never blocks checkout) ──
        commissionCalculationService.calculateForSale({
            salonId:         sale.salon_id,
            saleId:          sale.id,
            appointmentId:   sale.appointment_id ?? null,
            fallbackStaffId: sale.staff_id       ?? null,
            items,
        }).catch(() => {}); // already safe internally, double-guard here

        // ── WhatsApp Automation: Purchase confirmation (per item type) ─────────
        // service_purchased / product_purchased fire once each if that item type
        // is present — a mixed sale (e.g. one service + one product) intentionally
        // sends one text per type, not a single combined message. Membership items
        // are NOT fired here — that's centralized in clientMembershipsService
        // .autoCreateFromPayment() below, the single call site every membership
        // purchase path (QuickSale, calendar) already funnels through.
        if (sale.client_id && (sale as any).client_phone) {
            const presentTypes = new Set(items.map((i) => i.item_type));
            const purchaseEvents: Array<{ eventType: "service_purchased" | "product_purchased"; itemType: "service" | "product" }> = [
                { eventType: "service_purchased", itemType: "service" },
                { eventType: "product_purchased", itemType: "product" },
            ];

            for (const { eventType, itemType } of purchaseEvents) {
                if (!presentTypes.has(itemType)) continue;
                const itemName = items.find((i) => i.item_type === itemType)?.name ?? "your purchase";
                whatsappAutomationService.trigger({
                    salonId:       sale.salon_id,
                    eventType,
                    clientId:      sale.client_id,
                    phone:         (sale as any).client_phone,
                    countryCode:   (sale as any).client_phone_code ?? null,
                    variables: {
                        "1": (sale as any).client_name ?? "Valued Customer",
                        "2": (sale as any).salon_name   ?? "our salon",
                        "3": itemName,
                    },
                    referenceId:   sale.id,
                    referenceType: "invoice",
                    dedupeByReference: true,
                }).catch(() => {});
            }

            // PDF receipt as a WhatsApp document attachment — best-effort, only
            // deliverable within 24h of the customer's last message. Failure here
            // is expected outside that window and never blocks the triggers above.
            sendPurchaseReceipt({
                salonId:     sale.salon_id,
                phone:       (sale as any).client_phone,
                countryCode: (sale as any).client_phone_code ?? null,
                clientId:    sale.client_id,
                clientName:  (sale as any).client_name ?? "Valued Customer",
                sale,
                items,
                appointment: null,
                paidAmount:  body.amount_paid,
                dueAmount:   Math.max(0, parseFloat(sale.total_amount) - body.amount_paid),
                couponCode:  null,
            }).catch(() => {});
        }

        // ── Auto-create client_memberships for membership items in this sale ────
        // Handles the QuickSale flow where there is no appointment
        if (sale.client_id) {
            const membershipItems = items.filter(
                (i) => i.item_type === "membership" && i.item_id,
            );
            for (const item of membershipItems) {
                const membershipId = item.item_id!;
                (async () => {
                    try {
                        const mem = await membershipsRepository.findById(membershipId, sale.salon_id);
                        if (!mem) return;
                        const totalSessions = mem.sessionType === "limited" ? (mem.numberOfSessions ?? 0) : 0;
                        const pricePaid = parseFloat(item.unit_price) * (item.quantity ?? 1);
                        await clientMembershipsService.autoCreateFromPayment(
                            sale.salon_id,
                            sale.client_id!,
                            membershipId,
                            item.name,
                            totalSessions,
                            pricePaid,
                            mem.colour,
                            undefined,
                            sale.appointment_id ?? undefined,
                            item.staff_id ?? sale.staff_id ?? undefined,
                            sale.id,
                        );
                    } catch (err: any) {
                        logger.warn("[sales/checkout] membership auto-create failed:", err?.message ?? err);
                    }
                })();
            }
        }

        return sale;
    },

    async exportSales(filters: {
        salon_id?: string;
        status?: string;
        date?: string;
        format: "csv" | "excel" | "pdf";
    }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
        const sales = await salesRepository.exportList({
            salon_id: filters.salon_id,
            status:   filters.status,
            date:     filters.date,
        });

        const dateLabel = filters.date ?? "all";
        const headers = ["ID", "Status", "Client ID", "Subtotal", "Discount", "Tip", "Tax", "Total", "Payment Method", "Created At"];
        const rows = sales.map(s => [
            s.id, s.status, s.client_id ?? "Walk-in",
            s.subtotal, s.discount_amount, s.tip_amount, s.tax_amount, s.total_amount,
            s.payment_method ?? "", new Date(s.created_at).toLocaleDateString("en-GB"),
        ]);

        // ── CSV ───────────────────────────────────────────────────────────────
        if (filters.format === "csv") {
            const csvLines = [headers.join(","), ...rows.map(r => r.join(","))];
            return {
                buffer:      Buffer.from(csvLines.join("\n"), "utf-8"),
                contentType: "text/csv",
                filename:    `sales_${dateLabel}.csv`,
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
                filename:    `sales_${dateLabel}.xlsx`,
            };
        }

        // ── PDF ───────────────────────────────────────────────────────────────
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: "A4", layout: "landscape" });
            const chunks: Buffer[] = [];

            doc.on("data", (chunk: Buffer) => chunks.push(chunk));
            doc.on("end", () => resolve({
                buffer:      Buffer.concat(chunks),
                contentType: "application/pdf",
                filename:    `sales_${dateLabel}.pdf`,
            }));
            doc.on("error", reject);

            // Title
            doc.fontSize(18).font("Helvetica-Bold")
                .text("Daily Sales Report", { align: "center" });
            doc.fontSize(11).font("Helvetica")
                .text(`Date: ${filters.date ?? "All"}`, { align: "center" });
            doc.moveDown(1.5);

            // Column widths
            const colWidths  = [60, 70, 100, 60, 60, 40, 40, 60, 90, 90];
            const startX     = 50;
            const rowHeight  = 20;
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
    },
};
