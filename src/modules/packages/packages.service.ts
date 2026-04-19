import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { packagesRepository } from "./packages.repository";
import type {
  CreatePackageDTO,
  UpdatePackageDTO,
  PackagesListQuery,
  Package,
} from "./packages.types";

export const packagesService = {

  async list(query: PackagesListQuery) {
    return packagesRepository.list(query);
  },

  async getById(id: string): Promise<Package> {
    const pkg = await packagesRepository.findById(id);
    if (!pkg) throw new Error(`Package '${id}' not found`);
    return pkg;
  },

  async create(data: CreatePackageDTO): Promise<Package> {
    if (!data.slug) {
      data.slug = data.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    return packagesRepository.create(data);
  },

  async update(id: string, data: UpdatePackageDTO): Promise<Package> {
    const updated = await packagesRepository.update(id, data);
    if (!updated) throw new Error(`Package '${id}' not found`);
    return updated;
  },

  async delete(id: string): Promise<{ message: string }> {
    const deleted = await packagesRepository.delete(id);
    if (!deleted) throw new Error(`Package '${id}' not found`);
    return { message: "Package deleted successfully" };
  },

  // ── Export: CSV ────────────────────────────────────────────────────────────

  async exportCsv(query: PackagesListQuery): Promise<string> {
    const packages = await packagesRepository.listForExport(query);

    const headers = [
      "ID", "Name", "Slug", "Category", "Base Price",
      "Discount Value", "Discount Type", "Duration (min)",
      "Priority", "Services Count", "Offers Count", "Created At",
    ];

    const rows = packages.map((p) => [
      p.id,
      p.name,
      p.slug,
      p.category,
      p.basePrice,
      p.discountValue,
      p.discountType,
      p.durationMinutes,
      p.priority,
      p.serviceIds.length,
      p.offers.length,
      p.createdAt,
    ]);

    const lines = [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
    ];

    return lines.join("\n");
  },

  // ── Export: Excel ──────────────────────────────────────────────────────────

  async exportExcel(query: PackagesListQuery): Promise<Buffer> {
    const packages = await packagesRepository.listForExport(query);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Packages");

    ws.columns = [
      { header: "ID",             key: "id",              width: 38 },
      { header: "Name",           key: "name",            width: 30 },
      { header: "Slug",           key: "slug",            width: 30 },
      { header: "Category",       key: "category",        width: 15 },
      { header: "Base Price",     key: "basePrice",       width: 14 },
      { header: "Discount Value", key: "discountValue",   width: 16 },
      { header: "Discount Type",  key: "discountType",    width: 15 },
      { header: "Duration (min)", key: "durationMinutes", width: 16 },
      { header: "Priority",       key: "priority",        width: 10 },
      { header: "Services",       key: "servicesCount",   width: 10 },
      { header: "Offers",         key: "offersCount",     width: 10 },
      { header: "Created At",     key: "createdAt",       width: 26 },
    ];

    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0F7F5" },
    };

    packages.forEach((p) => {
      ws.addRow({
        id:              p.id,
        name:            p.name,
        slug:            p.slug,
        category:        p.category,
        basePrice:       p.basePrice,
        discountValue:   p.discountValue,
        discountType:    p.discountType,
        durationMinutes: p.durationMinutes,
        priority:        p.priority,
        servicesCount:   p.serviceIds.length,
        offersCount:     p.offers.length,
        createdAt:       p.createdAt,
      });
    });

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  },

  // ── Export: PDF ────────────────────────────────────────────────────────────

  exportPdf(query: PackagesListQuery): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const packages = await packagesRepository.listForExport(query);

        const doc = new PDFDocument({ margin: 40, size: "A4" });
        const chunks: Buffer[] = [];

        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // Title
        doc.fontSize(18).font("Helvetica-Bold").text("Packages Report", { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica").fillColor("#666")
          .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
        doc.moveDown(1);

        if (packages.length === 0) {
          doc.fontSize(12).fillColor("#333").text("No packages found.", { align: "center" });
        } else {
          packages.forEach((p, i) => {
            doc.fontSize(13).font("Helvetica-Bold").fillColor("#0d9488")
              .text(`${i + 1}. ${p.name}`);
            doc.fontSize(10).font("Helvetica").fillColor("#333");
            doc.text(`  Category: ${p.category}   Duration: ${p.durationMinutes} min   Priority: ${p.priority}`);
            doc.text(`  Base Price: ₹${p.basePrice}   Discount: ${p.discountValue} ${p.discountType}`);
            doc.text(`  Services: ${p.serviceIds.length}   Offers: ${p.offers.length}`);
            if (p.description) doc.text(`  ${p.description}`);
            doc.moveDown(0.6);
          });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  },
};
