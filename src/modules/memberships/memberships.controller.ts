import { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import { membershipsService } from "./memberships.service";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";

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

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const items = await membershipsService.listAll(req.query, salonId);

      const headers = [
        "Name", "Description", "Session Type", "Sessions",
        "Valid For", "Price", "Tax Rate", "Colour",
        "Online Sales", "Online Redemption", "Services"
      ];

      const escape = (val: any) => {
        const str = val === null || val === undefined ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };

      const rows = items.map((m) => [
        escape(m.name),
        escape(m.description ?? ""),
        escape(m.sessionType),
        escape(m.numberOfSessions ?? "Unlimited"),
        escape(m.validFor),
        escape(m.price),
        escape(m.taxRate ?? "No tax"),
        escape(m.colour),
        escape(m.enableOnlineSales ? "Yes" : "No"),
        escape(m.enableOnlineRedemption ? "Yes" : "No"),
        escape(m.includedServices.map((s) => s.serviceName).join(" | ")),
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
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

      const headers = [
        "Name", "Description", "Session Type", "Sessions",
        "Valid For", "Price", "Tax Rate", "Colour",
        "Online Sales", "Online Redemption", "Services",
      ];
      sheet.addRow(headers).font = { bold: true };

      items.forEach((m) => {
        sheet.addRow([
          m.name,
          m.description ?? "",
          m.sessionType,
          m.sessionType === "unlimited" ? "Unlimited" : (m.numberOfSessions ?? ""),
          m.validFor,
          Number(m.price),
          m.taxRate != null ? `${m.taxRate}%` : "No tax",
          m.colour,
          m.enableOnlineSales ? "Yes" : "No",
          m.enableOnlineRedemption ? "Yes" : "No",
          m.includedServices.map((s) => s.serviceName).join(" | "),
        ]);
      });

      sheet.columns.forEach((col) => { col.width = 20; });

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

      // Build HTML → PDF using pdfkit (already in your backend deps)
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 40, size: "A4" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="memberships_${Date.now()}.pdf"`);
      doc.pipe(res);

      // Title
      doc.fontSize(18).font("Helvetica-Bold").text("Memberships Report", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica").fillColor("#666")
        .text(`Generated: ${new Date().toLocaleString("en-IN")}`, { align: "center" });
      doc.moveDown(1);

      // Table header
      const colX    = [40, 180, 270, 340, 400, 460];
      const colHead = ["Name", "Valid For", "Sessions", "Price", "Tax", "Online Sales"];

      doc.fontSize(9).font("Helvetica-Bold").fillColor("#000");
      colHead.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: 120, continued: i < colHead.length - 1 }));
      doc.moveDown(0.3);

      // Divider
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke("#ccc");
      doc.moveDown(0.3);

      // Rows
      doc.font("Helvetica").fontSize(8).fillColor("#333");
      items.forEach((m) => {
        const y = doc.y;
        const cols = [
          m.name,
          m.validFor,
          m.sessionType === "unlimited" ? "Unlimited" : `${m.numberOfSessions ?? "–"} sessions`,
          `Rs.${Number(m.price).toLocaleString("en-IN")}`,
          m.taxRate ? `${m.taxRate}%` : "No tax",
          m.enableOnlineSales ? "Yes" : "No",
        ];
        cols.forEach((c, i) => doc.text(String(c), colX[i], y, { width: 115 }));
        doc.moveDown(1.2);

        // Services sub-row
        if (m.includedServices.length > 0) {
          doc.fillColor("#888").fontSize(7)
            .text(
              `Services: ${m.includedServices.map((s) => s.serviceName).join(", ")}`,
              52, doc.y - 8, { width: 500 }
            );
          doc.fillColor("#333").fontSize(8);
          doc.moveDown(0.5);
        }

        // Row divider
        doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke("#eee");
        doc.moveDown(0.3);

        // Page break
        if (doc.y > 750) doc.addPage();
      });

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
