import type { Membership } from "./memberships.types";

// The Memberships list screen's seven columns, built ONCE here so the PDF, Excel and CSV downloads always show exactly what the
// screen shows (same labels, same wording for Benefit / Fee / Expiry). Mirrors the frontend's features/catalog/utils/membershipMeta.ts.
export const MEMBERSHIP_EXPORT_HEADERS = [
  "Membership Name", "Membership Type", "Benefit", "Applies To", "Membership Fee", "Expiry", "Created At",
] as const;

const TYPE_LABEL: Record<string, string> = { value: "Wallet", percentage: "Discount Balance", loyalty: "Loyalty" };
const APPLIES_TO_LABEL: Record<string, string> = { services: "Services", products: "Products", both: "Services & Products" };

// A Wallet plan's bonus credit is packed into the `description` string as JSON ({"description": "...", "bonusCredit": N}).
function bonusCredit(description?: string | null): number {
  if (!description) return 0;
  try {
    const parsed = JSON.parse(description);
    return parsed && typeof parsed === "object" ? Number(parsed.bonusCredit) || 0 : 0;
  } catch {
    return 0;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export function formatCreatedAt(value?: Date | string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** One row of display text per membership, in MEMBERSHIP_EXPORT_HEADERS order. `money` formats an amount in the salon's currency. */
export function membershipExportRow(m: Membership, money: (amount: number) => string): string[] {
  const type = m.pricingType ?? "value";
  let benefit: string;
  if (type === "percentage") {
    benefit = `${m.discountPercent ?? 0}% Discount`;
  } else if (type === "loyalty") {
    const tiers = m.loyaltyTiers ?? [];
    benefit = tiers.length ? tiers.map((t) => `${t.thresholdValue} Visits -> ${t.discountPercent}%`).join(", ") : "No tiers configured";
  } else {
    const bonus = bonusCredit(m.description);
    benefit = `${money(Number(m.price) || 0)}${bonus > 0 ? ` +${money(bonus)} bonus` : ""}`;
  }
  const expiry = type === "loyalty" ? (m.validFor && m.validFor !== "lifetime" ? m.validFor : "Lifetime") : (m.validFor ?? "");
  return [
    m.name ?? "",
    TYPE_LABEL[type] ?? "Wallet",
    benefit,
    APPLIES_TO_LABEL[m.appliesTo ?? "services"] ?? "Services",
    type === "loyalty" ? "Free" : money(Number(m.price) || 0),
    expiry,
    formatCreatedAt(m.createdAt),
  ];
}
