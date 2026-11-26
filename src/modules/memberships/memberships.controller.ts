import { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import { membershipsService } from "./memberships.service";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";
import { getSalonCurrency, formatMoney, formatMoneyAscii } from "../../config/currency";
import { MEMBERSHIP_EXPORT_HEADERS, membershipExportRow } from "./memberships.export-columns";
import { dateLocale } from "../../config/currency";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const membershipsController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await membershipsService.list(req.query, salonId);
      return sendSuccess(res, 200, data, "Memberships fetched successfully");
    } catch (e) { return next(e); }
  },

  async filterOptions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await membershipsService.listFilterOptions(salonId);
      return sendSuccess(res, 200, data, "Membership filter options fetched successfully");
    } catch (e) { return next(e); }
  },

  async loyaltyEligibility(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const clientId = String(req.query.clientId ?? "");
      if (!clientId)
        throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
      const data = await membershipsService.getLoyaltyEligibility(clientId, salonId);
      return sendSuccess(res, 200, data, "Loyalty eligibility fetched successfully");
    } catch (e) { return next(e); }
  },

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const items = await membershipsService.listAll(req.query, salonId);

      const salonCurrency = await getSalonCurrency(salonId);
      const money = (n: number) => formatMoney(n, salonCurrency);

      const escape = (val: any) => {
        const str = val === null || val === undefined ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };

      // The same seven columns as the Memberships screen (see memberships.export-columns.ts).
      const rows = items.map((m) => membershipExportRow(m, money).map(escape));

      // The leading BOM makes Excel read the file as UTF-8, so currency symbols such as ₹ show correctly.
      const csv = "﻿" + [MEMBERSHIP_EXPORT_HEADERS.join(","), ...rows.map((r) => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="memberships_${Date.now()}.csv"`);
      return res.send(csv);
    } catch (e) { return next(e); }
  },

  async exportExcel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const items = await membershipsService.listAll(req.query, salonId);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Memberships");

      const salonCurrency = await getSalonCurrency(salonId);
      const money = (n: number) => formatMoney(n, salonCurrency);

      // The same seven columns as the Memberships screen (see memberships.export-columns.ts).
      sheet.addRow([...MEMBERSHIP_EXPORT_HEADERS]).font = { bold: true };
      items.forEach((m) => { sheet.addRow(membershipExportRow(m, money)); });

      const widths = [30, 20, 34, 22, 18, 16, 14];
      sheet.columns.forEach((col, i) => { col.width = widths[i] ?? 20; });

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="memberships_${Date.now()}.xlsx"`,
      );
      return res.send(buffer);
    } catch (e) { return next(e); }
  },

  async exportPdf(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const items = await membershipsService.listAll(req.query, salonId);
      const salonCurrency = await getSalonCurrency(salonId);

      // PDF built with pdfkit: the Memberships screen's seven columns, on a landscape page so every column has room; long text wraps inside its cell.
      const PDFDocument = require("pdfkit");
      const MARGIN = 40;
      const doc = new PDFDocument({ margin: MARGIN, size: "A4", layout: "landscape", bufferPages: true });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="memberships_${Date.now()}.pdf"`);
      doc.pipe(res);

      const pageWidth = doc.page.width - MARGIN * 2;           // 762pt on landscape A4
      const bottomLimit = doc.page.height - MARGIN - 20;       // leave room for the page-number footer
      const PAD_X = 6;
      const PAD_Y = 6;
      const BORDER = "#CBD5E1";
      // Name | Type | Benefit | Applies To | Fee | Expiry | Created At. Name takes what the fixed columns leave, so the figures line up on every page.
      const fixed = [95, 175, 105, 95, 80, 70];
      const colWidths = [pageWidth - fixed.reduce((a, b) => a + b, 0), ...fixed];
      const colX = colWidths.map((_, i) => MARGIN + colWidths.slice(0, i).reduce((a, b) => a + b, 0));
      const colHead = [...MEMBERSHIP_EXPORT_HEADERS] as string[];
      const colAlign: ("left" | "right")[] = ["left", "left", "left", "left", "right", "left", "left"];
      const textWidth = (i: number) => colWidths[i] - PAD_X * 2;

      // Title block (first page only)
      doc.fillColor("#000").fontSize(18).font("Helvetica-Bold").text("Memberships Report", MARGIN, MARGIN, { width: pageWidth, align: "center" });
      doc.moveDown(0.4);
      doc.fontSize(10).font("Helvetica").fillColor("#666")
        .text(`Generated: ${new Date().toLocaleString(dateLocale(salonCurrency))}`, MARGIN, doc.y, { width: pageWidth, align: "center" });
      let y = doc.y + 18;

      // One bordered row: cells share the same top and height so borders and text line up.
      const drawRow = (cells: string[], top: number, height: number, opts: { header?: boolean }) => {
        if (opts.header) doc.rect(MARGIN, top, pageWidth, height).fill("#F1F5F9");
        doc.lineWidth(0.5).strokeColor(BORDER);
        cells.forEach((c, i) => {
          doc.rect(colX[i], top, colWidths[i], height).stroke();
          doc.font(opts.header ? "Helvetica-Bold" : "Helvetica").fontSize(opts.header ? 9 : 9).fillColor(opts.header ? "#0F172A" : "#1E293B")
            .text(c, colX[i] + PAD_X, top + PAD_Y, { width: textWidth(i), align: colAlign[i] });
        });
      };
      const rowHeight = (cells: string[], header: boolean) => {
        doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        const tallest = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: textWidth(i), align: colAlign[i] })));
        return tallest + PAD_Y * 2;
      };

      const drawHeader = () => {
        const h = rowHeight(colHead, true);
        drawRow(colHead, y, h, { header: true });
        y += h;
      };
      drawHeader();

      items.forEach((m) => {
        const cells = membershipExportRow(m, (n) => formatMoneyAscii(n, salonCurrency));
        const h = rowHeight(cells, false);
        if (y + h > bottomLimit) {            // next row would not fit: new page, repeat the header
          doc.addPage();
          y = MARGIN;
          drawHeader();
        }
        drawRow(cells, y, h, {});
        y += h;
      });

      // Page numbers
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        // The footer sits inside the bottom margin; without zeroing it pdfkit would start a new blank page for this text.
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(8).fillColor("#94A3B8")
          .text(`Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN + 6, { width: pageWidth, align: "center", lineBreak: false });
        doc.page.margins.bottom = bottomMargin;
      }

      doc.end();
    } catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await membershipsService.create(req.body, salonId);
      return sendSuccess(res, 201, data, "Membership created successfully");
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await membershipsService.getById(req.params.id as string, salonId);
      return sendSuccess(res, 200, data, "Membership fetched successfully");
    } catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await membershipsService.update(req.params.id as string, req.body, salonId);
      return sendSuccess(res, 200, data, "Membership updated successfully");
    } catch (e) { return next(e); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await membershipsService.delete(req.params.id as string, salonId);
      return sendSuccess(res, 200, {}, "Membership deleted successfully");
    } catch (e) { return next(e); }
  },
};
