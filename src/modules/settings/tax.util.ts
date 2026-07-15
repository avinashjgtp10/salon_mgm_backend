import { settingsRepository } from "./settings.repository";

export interface TaxApplicableFor {
  service: boolean;
  product: boolean;
  membership: boolean;
  packages: boolean;
}

export interface ActiveTaxRow {
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

// Mirrors the frontend's src/features/settings/utils/taxSettings.ts. Tax rows
// are stored as JSON-encoded values in the generic salon_settings key/value
// table (see settings.repository.ts — it only has key/value/description
// columns), so the shape has to be parsed and filtered the same way here.
export async function getActiveTaxes(salonId: string): Promise<ActiveTaxRow[]> {
  const rows = await settingsRepository.findAll(salonId);
  return rows
    .map((r) => parseTaxValue(r.value))
    .filter((v) => v.active && (v.tax_type !== undefined || v.applicable_for !== undefined))
    .map((v) => ({
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

type BucketType = "service" | "product" | "membership" | "packages";

// Only the exclusive (add-on-top) tax total affects the amount actually owed
// — inclusive taxes are already baked into the item price, so they don't
// change the total, only its breakdown (which is a display-only concern,
// already handled by the frontend's receipt/bill views).
export function computeExclusiveTaxAddOn(
  buckets: { type: BucketType; base: number }[],
  taxes: ActiveTaxRow[]
): number {
  let addOn = 0;
  buckets.forEach(({ type, base }) => {
    if (base <= 0) return;
    taxes
      .filter((t) => t.applicable_for[type] && t.tax_value > 0 && !t.inclusive_taxes)
      .forEach((t) => {
        addOn += (base * t.tax_value) / 100;
      });
  });
  return addOn;
}
