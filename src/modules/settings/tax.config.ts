import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { settingsRepository, invalidateSettingsCache } from "./settings.repository";
import type { Setting } from "./settings.types";

// Settings → Tax Mapping configuration rules. Each tax is one salon_settings row (key = tax name, JSON value) — the same shape
// getActiveTaxes()/the pricing engine already read, so calculation (POS, Quick Sale, Checkout, invoices, reports) is untouched.
//
// "Categories" are the four things a tax can apply to: service, product, membership, packages.
// Stacking is NOT supported: at most ONE active tax may cover a category, which is what guarantees a tax is never applied twice.
// To change which tax covers a category the owner confirms a reassignment (resolve=true) — nothing is overwritten silently.

export const TAX_CATEGORIES = ["service", "product", "membership", "packages"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

const RESERVED_KEYS = new Set([
  "TAX_MODULE_CONFIG", "integrations_config", "notification_preferences", "whatsapp_notification_preferences",
  "REWARD_POINTS_CONFIG", "REFERRAL_CONFIG", "PRINT_CONFIG", "package_no_show_policy", "redeem_otp_required",
  "role_permissions", "subscription_permissions",
]);

export interface TaxValue {
  tax_type: string;
  tax_value: string | number;
  active: boolean;
  inclusive_taxes: boolean;
  applicable_for: Record<TaxCategory, boolean>;
  display_name?: string;
}
export interface TaxConflict { id: string; name: string; rate: number; categories: TaxCategory[] }
export interface SaveTaxInput { id?: string | null; key: string; value: unknown; resolve?: boolean }

function parse(raw: string | null): any {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && typeof p === "object" ? p : null; } catch { return null; }
}
const isTaxRow = (s: Setting) => {
  if (RESERVED_KEYS.has(s.key)) return false;
  const p = parse(s.value);
  return !!p && (p.tax_type !== undefined || p.applicable_for !== undefined);
};
const catsOf = (v: any): TaxCategory[] => TAX_CATEGORIES.filter((c) => !!v?.applicable_for?.[c]);

function normalise(input: SaveTaxInput): { key: string; value: TaxValue } {
  const key = String(input.key ?? "").trim();
  if (!key) throw new AppError(400, "Tax name is required", "VALIDATION_ERROR");
  if (key.length > 100) throw new AppError(400, "Tax name must be 100 characters or fewer", "VALIDATION_ERROR");
  if (RESERVED_KEYS.has(key)) throw new AppError(400, `"${key}" is a reserved name — choose another tax name`, "VALIDATION_ERROR");
  const v: any = typeof input.value === "string" ? parse(input.value) : input.value;
  if (!v || typeof v !== "object") throw new AppError(400, "Invalid tax configuration", "VALIDATION_ERROR");
  const rate = Number(v.tax_value);
  if (v.tax_value === "" || v.tax_value == null || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new AppError(400, "Tax percentage must be a number between 0 and 100", "VALIDATION_ERROR");
  }
  const applicable = Object.fromEntries(TAX_CATEGORIES.map((c) => [c, !!v.applicable_for?.[c]])) as Record<TaxCategory, boolean>;
  if (!TAX_CATEGORIES.some((c) => applicable[c])) throw new AppError(400, "Select at least one applicable category", "VALIDATION_ERROR");
  const active = !!v.active;
  return { key, value: { tax_type: String(v.tax_type ?? ""), tax_value: String(v.tax_value), active, inclusive_taxes: active && !!v.inclusive_taxes, applicable_for: applicable, display_name: key } };
}

// The only combinations that are allowed to stack on one category — they are components of a single charge, not duplicates:
// CGST + SGST (the two halves of intra-state GST) and CESS on top of another tax. Everything else (GST+GST, GST+"Service Tax",
// VAT+GST...) is a duplicate. Calculation order is the pricing engine's: every exclusive tax is added on the same taxable base
// (no tax-on-tax), inclusive taxes are carved out of the price together.
function canStack(a: string, b: string): boolean {
  const x = a.trim().toUpperCase(), y = b.trim().toUpperCase();
  if (x === y) return false;
  if (x === "CESS" || y === "CESS") return true;
  return (x === "CGST" && y === "SGST") || (x === "SGST" && y === "CGST");
}

// Active taxes (other than `selfId`) that already cover any of the candidate's categories. Empty for an inactive candidate.
export function findConflicts(rows: Setting[], candidate: TaxValue, selfId?: string | null): TaxConflict[] {
  if (!candidate.active) return [];
  const wanted = new Set(catsOf(candidate));
  const out: TaxConflict[] = [];
  for (const r of rows) {
    if (!isTaxRow(r) || (selfId && r.id === selfId)) continue;
    const v = parse(r.value);
    if (!v?.active || canStack(String(candidate.tax_type ?? ""), String(v.tax_type ?? ""))) continue;
    const overlap = catsOf(v).filter((c) => wanted.has(c));
    if (overlap.length) out.push({ id: r.id, name: String(v.display_name ?? r.key), rate: Number(v.tax_value) || 0, categories: overlap });
  }
  return out;
}

async function audit(db: { query: (q: string, p: unknown[]) => Promise<unknown> }, e: {
  salonId: string; settingId: string | null; name: string; action: string; before: unknown; after: unknown; note?: string; by: string | null;
}) {
  try {
    await db.query(
      `INSERT INTO tax_config_audit (salon_id, setting_id, tax_name, action, before_value, after_value, note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.salonId, e.settingId, e.name, e.action, e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null, e.note ?? null, e.by],
    );
  } catch (err) {
    // Audit table not migrated yet — never block saving a tax over it.
    logger.warn("tax_config_audit insert skipped", { error: (err as Error).message });
  }
}

// The settings key must be unique per salon, but tax NAMES need not be: "GST" for Service and "GST" for Product (different %) are
// two independent configurations. The label shown/used everywhere is value.display_name (falls back to the key for older rows);
// when a name is already taken as a key the stored key just gets a " (2)" style suffix.
const nameOf = (r: Setting) => String(parse(r.value)?.display_name ?? r.key);

function uniqueKey(rows: Setting[], name: string, selfId?: string | null): string {
  const taken = new Set(rows.filter((r) => r.id !== selfId).map((r) => r.key.trim().toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) { const k = `${name} (${n})`; if (!taken.has(k.toLowerCase())) return k; }
}

export const taxConfigService = {
  async check(salonId: string, input: SaveTaxInput) {
    const { value } = normalise(input);
    const rows = await settingsRepository.findAll(salonId);
    return { conflicts: findConflicts(rows, value, input.id) };
  },

  async save(salonId: string, userId: string | null, input: SaveTaxInput) {
    const { key: name, value } = normalise(input);
    const rows = await settingsRepository.findAll(salonId);
    if (input.id && !rows.some((r) => r.id === input.id && isTaxRow(r))) throw new AppError(404, "Tax configuration not found", "NOT_FOUND");

    let conflicts = findConflicts(rows, value, input.id);
    if (conflicts.length && !input.resolve) {
      throw new AppError(409, "An active tax already applies to one or more selected categories", "TAX_CONFLICT", { conflicts });
    }

    // "Update existing tax": when the one tax in the way covers ONLY categories being re-configured, update that very row in
    // place (new name/rate/status) instead of leaving an emptied, deactivated copy behind. Anything else only moves categories.
    let targetId: string | null = input.id ?? null;
    if (!targetId && conflicts.length === 1) {
      const row = rows.find((r) => r.id === conflicts[0].id)!;
      if (catsOf(parse(row.value)).every((c) => conflicts[0].categories.includes(c))) { targetId = row.id; conflicts = []; }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Reassign ONLY the selected categories away from the existing taxes; their other categories and settings stay as they were.
      for (const c of conflicts) {
        const row = rows.find((r) => r.id === c.id)!;
        const before = parse(row.value);
        const after = { ...before, applicable_for: { ...before.applicable_for } };
        c.categories.forEach((cat) => { after.applicable_for[cat] = false; });
        const emptied = catsOf(after).length === 0;
        if (emptied) after.active = false; // kept (not deleted) so its history stays; it no longer covers anything
        await client.query(`UPDATE salon_settings SET value = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`, [JSON.stringify(after), c.id, salonId]);
        await audit(client, { salonId, settingId: c.id, name: nameOf(row), action: emptied ? "deactivated_reassigned" : "categories_reassigned", before, after,
          note: `${c.categories.join(", ")} moved to "${name}"`, by: userId });
      }

      let saved: Setting;
      if (targetId) {
        const prev = rows.find((r) => r.id === targetId)!;
        // keep the stored key when the name is unchanged, so nothing that points at it moves
        const key = nameOf(prev).toLowerCase() === name.toLowerCase() ? prev.key : uniqueKey(rows, name, targetId);
        const { rows: r } = await client.query(`UPDATE salon_settings SET key = $1, value = $2, updated_at = NOW() WHERE id = $3 AND salon_id = $4 RETURNING *`,
          [key, JSON.stringify(value), targetId, salonId]);
        saved = r[0];
        await audit(client, { salonId, settingId: saved.id, name, action: "updated", before: parse(prev.value), after: value, by: userId });
      } else {
        const { rows: r } = await client.query(`INSERT INTO salon_settings (salon_id, key, value) VALUES ($1,$2,$3) RETURNING *`, [salonId, uniqueKey(rows, name), JSON.stringify(value)]);
        saved = r[0];
        await audit(client, { salonId, settingId: saved.id, name, action: "created", before: null, after: value, by: userId });
      }
      await client.query("COMMIT");
      invalidateSettingsCache(salonId);
      return { setting: saved, reassigned: conflicts };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
