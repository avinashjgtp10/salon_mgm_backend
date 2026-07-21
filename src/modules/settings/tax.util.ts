import { settingsRepository } from "./settings.repository";

export interface TaxApplicableFor {
  service: boolean;
  product: boolean;
  membership: boolean;
  packages: boolean;
}

export interface ActiveTaxRow {
  // The tax's display name — sourced from the settings row's `key` column,
  // not the parsed JSON value (mirrors the frontend's taxSettings.ts, which
  // does `tax_name: s.key`). Needed for the per-tax-name `taxBreakdown` the
  // pricing engine produces; unused by computeExclusiveTaxAddOn below.
  tax_name: string;
  tax_value: number;
  inclusive_taxes: boolean;
  applicable_for: TaxApplicableFor;
}

function parseTaxValue(raw: string | null): any {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // legacy/plain value (e.g. notification_preferences) — not a tax row
  }
}

const TAX_MODULE_SETTING_KEY = "TAX_MODULE_CONFIG";

export interface TaxModuleConfig {
  enabled: boolean;
  invoice_prefix: string;
  show_breakup_on_invoice: boolean;
  enable_gst_reports: boolean;
}

const DEFAULT_TAX_MODULE_CONFIG: TaxModuleConfig = {
  enabled: true,
  invoice_prefix: "INV",
  show_breakup_on_invoice: true,
  enable_gst_reports: true,
};

// Mirrors the frontend's src/features/settings/utils/taxModuleSettings.ts —
// same single-row, JSON-in-salon_settings convention as the tax mapping rows.
export async function getTaxModuleConfig(salonId: string): Promise<TaxModuleConfig> {
  const rows = await settingsRepository.findAll(salonId);
  const row = rows.find((r) => r.key === TAX_MODULE_SETTING_KEY);
  if (!row) return DEFAULT_TAX_MODULE_CONFIG;
  const parsed = parseTaxValue(row.value);
  return { ...DEFAULT_TAX_MODULE_CONFIG, ...parsed };
}

// Mirrors the frontend's src/features/settings/utils/taxSettings.ts. Tax rows
// are stored as JSON-encoded values in the generic salon_settings key/value
// table (see settings.repository.ts — it only has key/value/description
// columns), so the shape has to be parsed and filtered the same way here.
// Returns none at all when the master "Enable GST" toggle is off, regardless
// of individual tax mapping rows' own `active` flag — the one enforcement
// point so every caller (payment totals, invoice generation) is automatically
// tax-free without its own check.
export async function getActiveTaxes(salonId: string): Promise<ActiveTaxRow[]> {
  const moduleConfig = await getTaxModuleConfig(salonId);
  if (!moduleConfig.enabled) return [];

  const rows = await settingsRepository.findAll(salonId);
  return rows
    .map((r) => ({ ...parseTaxValue(r.value), key: r.key }))
    .filter((v) => v.active && (v.tax_type !== undefined || v.applicable_for !== undefined))
    .map((v) => ({
      tax_name: v.key ?? "",
      tax_value: Number(v.tax_value) || 0,
      inclusive_taxes: Boolean(v.inclusive_taxes),
      applicable_for: {
        service: Boolean(v.applicable_for?.service),
        product: Boolean(v.applicable_for?.product),
        membership: Boolean(v.applicable_for?.membership),
        packages: Boolean(v.applicable_for?.packages),
      },
    }));
}

