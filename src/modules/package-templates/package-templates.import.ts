import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { packageTemplatesRepository } from "./package-templates.repository";
import { servicesRepository } from "../services/services.repository";

// One spreadsheet row = one service line of a package. Rows sharing a
// "Package Name" are folded into a single template, so a package with three
// services is three rows. Package-level columns (price, validity, ...) are
// read from every row of the group and must agree.
const REQUIRED_COLUMNS = ["Package Name", "Service Name", "Sessions", "Package Price", "Validity (days)"];
const OPTIONAL_COLUMNS = ["Description", "Service Price", "GST (%)", "Discount", "Category", "Duration (min)"];
// Category used for a service the import has to create when the sheet gives none.
const DEFAULT_CATEGORY = "General";
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

type Issue = { row: number; name: string; status: "skipped" | "failed"; reason: string; suggestion?: string };

interface ParsedLine {
  row: number;
  serviceName: string;
  totalSessions: number;
  servicePrice: number | null;
  packagePrice: number;
  neverExpires: boolean;
  expiryDays: number | null;
  description: string;
  gst: number;
  discount: number;
  /** True when the service isn't in the Services list yet and will be created. */
  isNew: boolean;
  category: string;
  duration: number;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const num = (v: unknown): number => Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));

export const packageTemplatesImport = {
  async importPackages(params: { rows: any[]; salonId: string }) {
    const { salonId } = params;
    const issues: Issue[] = [];
    const servicesAdded: { name: string; category: string; price: number; duration: number }[] = [];
    const result = { total_rows: params.rows.length, imported: 0, skipped: 0, failed: 0, issues, services_added: servicesAdded };

    if (params.rows.length === 0) return result;

    // Map whatever case/spacing the sheet used onto the canonical header names.
    const canonical = new Map(ALL_COLUMNS.map((c) => [norm(c), c]));
    const headers = Object.keys(params.rows[0]);
    const missing = REQUIRED_COLUMNS.filter((c) => !headers.some((h) => norm(h) === norm(c)));
    if (missing.length > 0) {
      throw new AppError(
        400,
        `Invalid import file format. The following required columns are missing: ${missing.join(", ")}`,
        "INVALID_IMPORT_COLUMNS",
      );
    }
    const unexpected = headers.filter((h) => !canonical.has(norm(h)));
    if (unexpected.length > 0) {
      throw new AppError(
        400,
        `Invalid import file format. Unexpected column(s) found: ${unexpected.join(", ")}`,
        "INVALID_IMPORT_COLUMNS",
      );
    }

    const rows = params.rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) out[canonical.get(norm(k))!] = v;
      return out;
    });

    const { rows: svcRows } = await pool.query(
      `SELECT name, price FROM services WHERE salon_id = $1`,
      [salonId],
    );
    const serviceByName = new Map<string, { name: string; price: number }>();
    for (const s of svcRows) serviceByName.set(norm(s.name), { name: s.name, price: Number(s.price) });

    const { rows: existingRows } = await pool.query(
      `SELECT name FROM package_templates WHERE salon_id = $1`,
      [salonId],
    );
    const existing = new Set<string>(existingRows.map((r: any) => norm(r.name)));

    // Group by package name, keeping first-seen order.
    const groups = new Map<string, { name: string; lines: ParsedLine[]; bad: Issue[] }>();
    rows.forEach((r, i) => {
      const rowNum = i + 1;
      const pkgName = String(r["Package Name"] ?? "").trim();
      const serviceName = String(r["Service Name"] ?? "").trim();

      // Fully blank spreadsheet lines are ignored rather than reported.
      if (!pkgName && !serviceName && !String(r["Sessions"] ?? "").trim()) return;

      if (!pkgName) {
        result.failed++;
        issues.push({ row: rowNum, name: "—", status: "failed", reason: "Package Name is required", suggestion: "Fill the Package Name on every row of the package." });
        return;
      }

      const key = norm(pkgName);
      if (!groups.has(key)) groups.set(key, { name: pkgName, lines: [], bad: [] });
      const g = groups.get(key)!;
      const fail = (reason: string, suggestion?: string): void => {
        g.bad.push({ row: rowNum, name: pkgName, status: "failed", reason, suggestion });
      };

      if (!serviceName) return fail("Service Name is required");
      // A service that isn't in the Services list yet is created on import
      // (only if its package goes through), so it is not an error here.
      const svc = serviceByName.get(norm(serviceName)) ?? null;

      const sessions = num(r["Sessions"]);
      if (!Number.isInteger(sessions) || sessions <= 0) return fail("Sessions must be a whole number greater than 0");

      const priceRaw = String(r["Package Price"] ?? "").trim();
      const packagePrice = num(priceRaw);
      if (!priceRaw || !Number.isFinite(packagePrice) || packagePrice < 0) return fail("Package Price must be a number (0 or more)");

      const validityRaw = String(r["Validity (days)"] ?? "").trim().toLowerCase();
      const neverExpires = validityRaw === "never";
      const expiryDays = neverExpires ? null : num(validityRaw);
      if (!neverExpires && (!validityRaw || !Number.isInteger(expiryDays) || (expiryDays as number) <= 0))
        return fail("Validity (days) must be a whole number greater than 0, or \"Never\"");

      const spRaw = String(r["Service Price"] ?? "").trim();
      const servicePrice = spRaw === "" ? (svc?.price ?? 0) : num(spRaw);
      if (!Number.isFinite(servicePrice) || servicePrice < 0) return fail("Service Price must be a number (0 or more)");

      const gst = String(r["GST (%)"] ?? "").trim() === "" ? 0 : num(r["GST (%)"]);
      const discount = String(r["Discount"] ?? "").trim() === "" ? 0 : num(r["Discount"]);
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) return fail("GST (%) must be between 0 and 100");
      if (!Number.isFinite(discount) || discount < 0 || discount > packagePrice) return fail("Discount must be between 0 and the Package Price");

      const durRaw = String(r["Duration (min)"] ?? "").trim();
      const duration = durRaw === "" ? 30 : num(durRaw);
      if (!Number.isInteger(duration) || duration < 5) return fail("Duration (min) must be a whole number of at least 5");

      g.lines.push({
        row: rowNum,
        serviceName: svc?.name ?? serviceName,
        isNew: !svc,
        category: String(r["Category"] ?? "").trim() || DEFAULT_CATEGORY,
        duration,
        totalSessions: sessions,
        servicePrice,
        packagePrice,
        neverExpires,
        expiryDays,
        description: String(r["Description"] ?? "").trim(),
        gst,
        discount,
      });
    });

    const { rows: catRows } = await pool.query(
      "SELECT id, name FROM service_categories WHERE salon_id = $1 AND type IN ('service', 'both')",
      [salonId],
    );
    const categoryByName = new Map<string, string>(catRows.map((c: any) => [norm(c.name), c.id]));
    const ensureCategory = async (name: string): Promise<string> => {
      const hit = categoryByName.get(norm(name));
      if (hit) return hit;
      const created = await pool.query(
        "INSERT INTO service_categories (salon_id, name, type) VALUES ($1, $2, 'service') RETURNING id",
        [salonId, name],
      );
      categoryByName.set(norm(name), created.rows[0].id);
      return created.rows[0].id;
    };

    for (const g of groups.values()) {
      const firstRow = g.bad[0]?.row ?? g.lines[0]?.row ?? 0;

      if (existing.has(norm(g.name))) {
        result.skipped++;
        issues.push({ row: firstRow, name: g.name, status: "skipped", reason: "Package already exists", suggestion: "Rename the package, or edit the existing one in Package Templates." });
        continue;
      }

      if (g.bad.length > 0) {
        result.failed++;
        issues.push(...g.bad);
        continue;
      }

      // Package-level values repeat on every row; a disagreement means the
      // sheet is ambiguous, so reject the package instead of guessing.
      const head = g.lines[0];
      const conflict = g.lines.find(
        (l) =>
          l.packagePrice !== head.packagePrice ||
          l.neverExpires !== head.neverExpires ||
          l.expiryDays !== head.expiryDays ||
          l.gst !== head.gst ||
          l.discount !== head.discount,
      );
      if (conflict) {
        result.failed++;
        issues.push({
          row: conflict.row,
          name: g.name,
          status: "failed",
          reason: "Package Price, Validity, GST or Discount differ between rows of the same package",
          suggestion: "Repeat the same package-level values on every row of this package.",
        });
        continue;
      }

      const seen = new Set<string>();
      const dupService = g.lines.find((l) => (seen.has(norm(l.serviceName)) ? true : (seen.add(norm(l.serviceName)), false)));
      if (dupService) {
        result.failed++;
        issues.push({
          row: dupService.row,
          name: g.name,
          status: "failed",
          reason: `Service "${dupService.serviceName}" is listed more than once in this package`,
          suggestion: "Combine the sessions into a single row for that service.",
        });
        continue;
      }

      try {
        // Create any service the package needs that isn't listed yet, once per
        // name even if several packages use it.
        for (const l of g.lines) {
          if (!l.isNew || serviceByName.has(norm(l.serviceName))) continue;
          const categoryId = await ensureCategory(l.category);
          await servicesRepository.create(
            { name: l.serviceName, category_id: categoryId, price_type: "fixed", price: l.servicePrice ?? 0, duration: l.duration } as any,
            salonId,
          );
          serviceByName.set(norm(l.serviceName), { name: l.serviceName, price: l.servicePrice ?? 0 });
          servicesAdded.push({ name: l.serviceName, category: l.category, price: l.servicePrice ?? 0, duration: l.duration });
        }

        await packageTemplatesRepository.create(salonId, {
          name: g.name,
          description: g.lines.find((l) => l.description)?.description ?? null,
          basePrice: head.packagePrice,
          gstPercentage: head.gst,
          discount: head.discount,
          neverExpires: head.neverExpires,
          expiryDays: head.expiryDays,
          services: g.lines.map((l) => ({
            serviceName: l.serviceName,
            totalSessions: l.totalSessions,
            // Same convention as the manual form: a line's price is the
            // per-session price times its sessions, not the per-session price.
            price: Math.round((l.servicePrice ?? 0) * l.totalSessions * 100) / 100,
          })),
        });
        existing.add(norm(g.name));
        result.imported++;
      } catch (err: any) {
        result.failed++;
        issues.push({ row: firstRow, name: g.name, status: "failed", reason: err?.message ?? "Failed to create package" });
      }
    }

    issues.sort((a, b) => a.row - b.row);
    return result;
  },
};
