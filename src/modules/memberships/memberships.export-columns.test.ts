// The PDF, Excel and CSV downloads all take their columns from this one helper, so they match the Memberships screen.
import { MEMBERSHIP_EXPORT_HEADERS, membershipExportRow } from "./memberships.export-columns";

const money = (n: number) => `Rs. ${n.toFixed(2)}`;
const base: any = { name: "Gold", validFor: "12 months", price: 1500, appliesTo: "services", pricingType: "value", createdAt: new Date(2026, 10, 2, 10, 0), includedServices: [] };

describe("membership export columns", () => {
  it("has exactly the seven columns the screen shows, in order", () => {
    expect([...MEMBERSHIP_EXPORT_HEADERS]).toEqual(["Membership Name", "Membership Type", "Benefit", "Applies To", "Membership Fee", "Expiry", "Created At"]);
    expect(membershipExportRow(base, money)).toHaveLength(7);
  });

  it("Wallet plan: benefit is the credit plus any bonus; fee is the price; date is DD/MM/YYYY", () => {
    expect(membershipExportRow(base, money)).toEqual(["Gold", "Wallet", "Rs. 1500.00", "Services", "Rs. 1500.00", "12 months", "02/11/2026"]);
    const withBonus = { ...base, description: JSON.stringify({ description: "d", bonusCredit: 200 }) };
    expect(membershipExportRow(withBonus, money)[2]).toBe("Rs. 1500.00 +Rs. 200.00 bonus");
  });

  it("a plain-text (non-JSON) description is not mistaken for a bonus", () => {
    expect(membershipExportRow({ ...base, description: "Just some words" }, money)[2]).toBe("Rs. 1500.00");
  });

  it("Discount Balance plan shows the discount percentage", () => {
    const row = membershipExportRow({ ...base, pricingType: "percentage", discountPercent: 15, appliesTo: "both" }, money);
    expect(row.slice(1, 5)).toEqual(["Discount Balance", "15% Discount", "Services & Products", "Rs. 1500.00"]);
  });

  it("Loyalty plan lists its tiers, is Free, and shows Lifetime when it never expires", () => {
    const row = membershipExportRow({ ...base, pricingType: "loyalty", validFor: "lifetime", appliesTo: "products", loyaltyTiers: [{ thresholdValue: 5, discountPercent: 10 }, { thresholdValue: 10, discountPercent: 20 }] }, money);
    expect(row).toEqual(["Gold", "Loyalty", "5 Visits -> 10%, 10 Visits -> 20%", "Products", "Free", "Lifetime", "02/11/2026"]);
    expect(membershipExportRow({ ...base, pricingType: "loyalty", loyaltyTiers: [] }, money)[2]).toBe("No tiers configured");
    expect(membershipExportRow({ ...base, pricingType: "loyalty", validFor: "6 months" }, money)[5]).toBe("6 months");
  });

  it("does not include the old Sessions / Online Sales / Tax columns", () => {
    expect([...MEMBERSHIP_EXPORT_HEADERS].join("|")).not.toMatch(/Session|Online|Tax/);
  });
});
