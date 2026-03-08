import { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import { Parser as CsvParser } from "json2csv";
import PDFDocument from "pdfkit";
import logger from "../../config/logger";
import { bundlesRepository, servicesRepository } from "./services.repository";
import {
  Bundle,
  ListBundlesQuery,
  ListServicesQuery,
  Service,
} from "./services.types";

const parseServiceQuery = (q: Record<string, unknown>): ListServicesQuery => ({
  category_id:           q.category_id as string | undefined,
  search:                q.search as string | undefined,
  status:                q.status as ListServicesQuery["status"],
  type:                  q.type as ListServicesQuery["type"],
  staff_id:              (q.team_member_id ?? q.staff_id) as string | undefined,
  online_booking:        q.online_booking as ListServicesQuery["online_booking"],
  commissions:           q.commissions as ListServicesQuery["commissions"],
  resource_requirements: q.resource_requirements as ListServicesQuery["resource_requirements"],
});

const parseBundleQuery = (q: Record<string, unknown>): ListBundlesQuery => ({
  category_id:           q.category_id as string | undefined,
  search:                q.search as string | undefined,
  status:                q.status as ListBundlesQuery["status"],
  team_member_id:        q.team_member_id as string | undefined,
  online_booking:        q.online_booking as ListBundlesQuery["online_booking"],
  commissions:           q.commissions as ListBundlesQuery["commissions"],
  resource_requirements: q.resource_requirements as ListBundlesQuery["resource_requirements"],
  available_for:         q.available_for as ListBundlesQuery["available_for"],
});

type DownloadRow = {
  record_type:        string;
  name:               string;
  category_name:      string;
  description:        string;
  price_type:         string;
  price:              string;
  duration:           string;
  treatment_type:     string;
  schedule_type:      string;
  available_for:      string;
  online_booking:     string;
  commission_enabled: string;
  resource_required:  string;
  is_active:          string;
  created_at:         string;
};

const HEADERS: { key: keyof DownloadRow; label: string }[] = [
  { key: "record_type",        label: "Type" },
  { key: "name",               label: "Name" },
  { key: "category_name",      label: "Category" },
  { key: "description",        label: "Description" },
  { key: "price_type",         label: "Price Type" },
  { key: "price",              label: "Price / Retail Price" },
  { key: "duration",           label: "Duration (min)" },
  { key: "treatment_type",     label: "Treatment Type" },
  { key: "schedule_type",      label: "Schedule Type" },
  { key: "available_for",      label: "Available For" },
  { key: "online_booking",     label: "Online Booking" },
  { key: "commission_enabled", label: "Commission" },
  { key: "resource_required",  label: "Resource Required" },
  { key: "is_active",          label: "Status" },
  { key: "created_at",         label: "Created At" },
];

const bool = (v: boolean) => (v ? "Yes" : "No");

const serviceToRow = (s: Service): DownloadRow => ({
  record_type:        "Service",
  name:               s.name,
  category_name:      s.category_name ?? "—",
  description:        s.description ?? "—",
  price_type:         s.price_type,
  price:              String(s.price),
  duration:           String(s.duration),
  treatment_type:     s.treatment_type ?? "—",
  schedule_type:      "—",
  available_for:      "—",
  online_booking:     bool(s.online_booking),
  commission_enabled: bool(s.commission_enabled),
  resource_required:  bool(s.resource_required),
  is_active:          bool(s.is_active),
  created_at:         new Date(s.created_at).toLocaleDateString(),
});

const bundleToRow = (b: Bundle): DownloadRow => ({
  record_type:        "Bundle",
  name:               b.name,
  category_name:      b.category_name ?? "—",
  description:        b.description ?? "—",
  price_type:         b.price_type,
  price:              String(b.retail_price),
  duration:           "—",
  treatment_type:     "—",
  schedule_type:      b.schedule_type,
  available_for:      b.available_for,
  online_booking:     bool(b.online_booking),
  commission_enabled: bool(b.commission_enabled),
  resource_required:  bool(b.resource_required),
  is_active:          bool(b.is_active),
  created_at:         new Date(b.created_at).toLocaleDateString(),
});

const fetchRows = async (q: Record<string, unknown>): Promise<DownloadRow[]> => {
  const [services, bundles] = await Promise.all([
    servicesRepository.listAll(parseServiceQuery(q)),
    bundlesRepository.listAll(parseBundleQuery(q)),
  ]);
  return [...services.map(serviceToRow), ...bundles.map(bundleToRow)];
};

// ─── PDF ──────────────────────────────────────────────────────────────────────

export const downloadCataloguePdf = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const rows = await fetchRows(req.query as Record<string, unknown>);
    logger.info("GET /download/pdf", { total: rows.length });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="catalogue.pdf"');

    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    doc.pipe(res);

    doc.fontSize(15).font("Helvetica-Bold").text("Services & Bundles Catalogue", { align: "center" });
    doc.fontSize(8).font("Helvetica").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
    doc.moveDown(0.8);

    const colWidths = [46, 90, 70, 44, 60, 42, 38, 56, 60, 40, 42, 44, 58, 38, 70];
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const startX = doc.page.margins.left;
    let y = doc.y;

    const drawRow = (
      cells: string[],
      isHeader: boolean,
      rowY: number,
      bg?: string
    ): number => {
      const rowH = 16;
      if (bg) doc.rect(startX, rowY, totalW, rowH).fill(bg);
      doc
        .font(isHeader ? "Helvetica-Bold" : "Helvetica")
        .fontSize(isHeader ? 7 : 6.5)
        .fillColor("black");
      let x = startX;
      cells.forEach((cell, i) => {
        doc.text(cell ?? "—", x + 2, rowY + 3, { width: colWidths[i] - 4, ellipsis: true });
        x += colWidths[i];
      });
      doc.rect(startX, rowY, totalW, rowH).stroke("#cccccc");
      return rowH;
    };

    const headerCells = HEADERS.map((h) => h.label);
    y += drawRow(headerCells, true, y, "#d9e1f2");

    rows.forEach((row, idx) => {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
        y += drawRow(headerCells, true, y, "#d9e1f2");
      }
      const cells = HEADERS.map((h) => row[h.key] ?? "—");
      const bg =
        row.record_type === "Bundle"
          ? idx % 2 === 0 ? "#fff9f0" : "#fff3e0"
          : idx % 2 === 0 ? "#ffffff" : "#f7f9ff";
      y += drawRow(cells, false, y, bg);
    });

    doc.end();
  } catch (err) {
    logger.error("GET /download/pdf error", { err });
    return next(err);
  }
};

// ─── Excel ────────────────────────────────────────────────────────────────────

export const downloadCatalogueExcel = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const rows = await fetchRows(req.query as Record<string, unknown>);
    logger.info("GET /download/excel", { total: rows.length });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Catalogue API";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Catalogue");
    const colWidths = [10, 28, 18, 30, 14, 18, 12, 18, 14, 14, 14, 14, 16, 10, 20];

    sheet.columns = HEADERS.map((h, i) => ({
      header: h.label,
      key: h.key,
      width: colWidths[i] ?? 14,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, size: 10, color: { argb: "FF1F3864" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 22;

    rows.forEach((row, idx) => {
      const r = sheet.addRow(row);
      const isBundle = row.record_type === "Bundle";
      const bgArgb = isBundle
        ? idx % 2 === 0 ? "FFFFF3E0" : "FFFFF9F0"
        : idx % 2 === 0 ? "FFFFFFFF" : "FFEFF3FB";
      r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      r.getCell("record_type").font = { bold: true, size: 9 };
    });

    sheet.eachRow((row: ExcelJS.Row) => {
      row.eachCell((cell: ExcelJS.Cell) => {
        cell.border = {
          top:    { style: "thin", color: { argb: "FFCCCCCC" } },
          left:   { style: "thin", color: { argb: "FFCCCCCC" } },
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
          right:  { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
    });

    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="catalogue.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error("GET /download/excel error", { err });
    return next(err);
  }
};

// ─── CSV ──────────────────────────────────────────────────────────────────────

export const downloadCatalogueCsv = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const rows = await fetchRows(req.query as Record<string, unknown>);
    logger.info("GET /download/csv", { total: rows.length });

    const fields = HEADERS.map((h) => ({ label: h.label, value: h.key }));
    const parser = new CsvParser<DownloadRow>({ fields });
    const csv = parser.parse(rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="catalogue.csv"');
    res.send(csv);
  } catch (err) {
    logger.error("GET /download/csv error", { err });
    return next(err);
  }
};

