"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCatalogueCsv = exports.downloadCatalogueExcel = exports.downloadCataloguePdf = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
const json2csv_1 = require("json2csv");
const pdfkit_1 = __importDefault(require("pdfkit"));
const logger_1 = __importDefault(require("../../config/logger"));
const services_repository_1 = require("./services.repository");
const parseServiceQuery = (q) => ({
    category_id: q.category_id,
    search: q.search,
    status: q.status,
    type: q.type,
    staff_id: (q.team_member_id ?? q.staff_id),
    online_booking: q.online_booking,
    commissions: q.commissions,
    resource_requirements: q.resource_requirements,
});
const parseBundleQuery = (q) => ({
    category_id: q.category_id,
    search: q.search,
    status: q.status,
    team_member_id: q.team_member_id,
    online_booking: q.online_booking,
    commissions: q.commissions,
    resource_requirements: q.resource_requirements,
    available_for: q.available_for,
});
const HEADERS = [
    { key: "record_type", label: "Type" },
    { key: "name", label: "Name" },
    { key: "category_name", label: "Category" },
    { key: "description", label: "Description" },
    { key: "price_type", label: "Price Type" },
    { key: "price", label: "Price / Retail Price" },
    { key: "duration", label: "Duration (min)" },
    { key: "treatment_type", label: "Treatment Type" },
    { key: "schedule_type", label: "Schedule Type" },
    { key: "available_for", label: "Available For" },
    { key: "online_booking", label: "Online Booking" },
    { key: "commission_enabled", label: "Commission" },
    { key: "resource_required", label: "Resource Required" },
    { key: "is_active", label: "Status" },
    { key: "created_at", label: "Created At" },
];
const bool = (v) => (v ? "Yes" : "No");
const serviceToRow = (s) => ({
    record_type: "Service",
    name: s.name,
    category_name: s.category_name ?? "—",
    description: s.description ?? "—",
    price_type: s.price_type,
    price: String(s.price),
    duration: String(s.duration),
    treatment_type: s.treatment_type ?? "—",
    schedule_type: "—",
    available_for: "—",
    online_booking: bool(s.online_booking),
    commission_enabled: bool(s.commission_enabled),
    resource_required: bool(s.resource_required),
    is_active: bool(s.is_active),
    created_at: new Date(s.created_at).toLocaleDateString(),
});
const bundleToRow = (b) => ({
    record_type: "Bundle",
    name: b.name,
    category_name: b.category_name ?? "—",
    description: b.description ?? "—",
    price_type: b.price_type,
    price: String(b.retail_price),
    duration: "—",
    treatment_type: "—",
    schedule_type: b.schedule_type,
    available_for: b.available_for,
    online_booking: bool(b.online_booking),
    commission_enabled: bool(b.commission_enabled),
    resource_required: bool(b.resource_required),
    is_active: bool(b.is_active),
    created_at: new Date(b.created_at).toLocaleDateString(),
});
const fetchRows = async (q) => {
    const [services, bundles] = await Promise.all([
        services_repository_1.servicesRepository.listAll(parseServiceQuery(q)),
        services_repository_1.bundlesRepository.listAll(parseBundleQuery(q)),
    ]);
    return [...services.map(serviceToRow), ...bundles.map(bundleToRow)];
};
// ─── PDF ──────────────────────────────────────────────────────────────────────
const downloadCataloguePdf = async (req, res, next) => {
    try {
        const rows = await fetchRows(req.query);
        logger_1.default.info("GET /download/pdf", { total: rows.length });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="catalogue.pdf"');
        const doc = new pdfkit_1.default({ margin: 36, size: "A4", layout: "landscape" });
        doc.pipe(res);
        doc.fontSize(15).font("Helvetica-Bold").text("Services & Bundles Catalogue", { align: "center" });
        doc.fontSize(8).font("Helvetica").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
        doc.moveDown(0.8);
        const colWidths = [46, 90, 70, 44, 60, 42, 38, 56, 60, 40, 42, 44, 58, 38, 70];
        const totalW = colWidths.reduce((a, b) => a + b, 0);
        const startX = doc.page.margins.left;
        let y = doc.y;
        const drawRow = (cells, isHeader, rowY, bg) => {
            const rowH = 16;
            if (bg)
                doc.rect(startX, rowY, totalW, rowH).fill(bg);
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
            const bg = row.record_type === "Bundle"
                ? idx % 2 === 0 ? "#fff9f0" : "#fff3e0"
                : idx % 2 === 0 ? "#ffffff" : "#f7f9ff";
            y += drawRow(cells, false, y, bg);
        });
        doc.end();
    }
    catch (err) {
        logger_1.default.error("GET /download/pdf error", { err });
        return next(err);
    }
};
exports.downloadCataloguePdf = downloadCataloguePdf;
// ─── Excel ────────────────────────────────────────────────────────────────────
const downloadCatalogueExcel = async (req, res, next) => {
    try {
        const rows = await fetchRows(req.query);
        logger_1.default.info("GET /download/excel", { total: rows.length });
        const workbook = new exceljs_1.default.Workbook();
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
        sheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin", color: { argb: "FFCCCCCC" } },
                    left: { style: "thin", color: { argb: "FFCCCCCC" } },
                    bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
                    right: { style: "thin", color: { argb: "FFCCCCCC" } },
                };
            });
        });
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="catalogue.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        logger_1.default.error("GET /download/excel error", { err });
        return next(err);
    }
};
exports.downloadCatalogueExcel = downloadCatalogueExcel;
// ─── CSV ──────────────────────────────────────────────────────────────────────
const downloadCatalogueCsv = async (req, res, next) => {
    try {
        const rows = await fetchRows(req.query);
        logger_1.default.info("GET /download/csv", { total: rows.length });
        const fields = HEADERS.map((h) => ({ label: h.label, value: h.key }));
        const parser = new json2csv_1.Parser({ fields });
        const csv = parser.parse(rows);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="catalogue.csv"');
        res.send(csv);
    }
    catch (err) {
        logger_1.default.error("GET /download/csv error", { err });
        return next(err);
    }
};
exports.downloadCatalogueCsv = downloadCatalogueCsv;
//# sourceMappingURL=services.download.controller.ts.js.map