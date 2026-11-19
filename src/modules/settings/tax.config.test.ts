// Tax Mapping conflict rules: at most one active tax per category (no accidental duplicates / double tax), except the explicit
// stackable combinations (CGST+SGST, CESS). Inactive taxes never conflict.
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), log: jest.fn() } }));
jest.mock("./settings.repository", () => ({ settingsRepository: { findAll: jest.fn() }, invalidateSettingsCache: jest.fn() }));

import { findConflicts, type TaxValue } from "./tax.config";

const cats = (...on: string[]) => ({ service: on.includes("service"), product: on.includes("product"), membership: on.includes("membership"), packages: on.includes("packages") });
const row = (id: string, key: string, type: string, rate: number, active: boolean, ...on: string[]) => ({
  id, salon_id: "s", key, description: null, created_at: "", updated_at: "",
  value: JSON.stringify({ tax_type: type, tax_value: String(rate), active, inclusive_taxes: false, applicable_for: cats(...on) }),
});
const cand = (type: string, active: boolean, ...on: string[]): TaxValue =>
  ({ tax_type: type, tax_value: "10", active, inclusive_taxes: false, applicable_for: cats(...on) });

describe("findConflicts", () => {
  const gst = row("1", "GST", "GST", 18, true, "service", "product");

  it("flags an active tax already on the same category, with its rate", () => {
    expect(findConflicts([gst], cand("Other", true, "service"))).toEqual([{ id: "1", name: "GST", rate: 18, categories: ["service"] }]);
  });
  it("lists every affected category and tax when several overlap", () => {
    const members = row("2", "Membership Tax", "Other", 20, true, "membership");
    const out = findConflicts([gst, members], cand("Other", true, "service", "product", "membership", "packages"));
    expect(out.map((c) => [c.name, c.categories])).toEqual([["GST", ["service", "product"]], ["Membership Tax", ["membership"]]]);
  });
  it("allows different taxes on different categories (independent configurations)", () => {
    expect(findConflicts([gst], cand("Other", true, "membership", "packages"))).toEqual([]);
  });
  it("ignores inactive existing taxes and inactive candidates (disabling never conflicts)", () => {
    expect(findConflicts([row("3", "Old", "GST", 5, false, "service")], cand("GST", true, "service"))).toEqual([]);
    expect(findConflicts([gst], cand("Other", false, "service"))).toEqual([]);
  });
  it("does not conflict with itself when editing", () => {
    expect(findConflicts([gst], cand("GST", true, "service", "product"), "1")).toEqual([]);
  });
  it("lets CGST+SGST and CESS stack, but not two of the same type", () => {
    const cgst = row("4", "CGST", "CGST", 9, true, "service");
    expect(findConflicts([cgst], cand("SGST", true, "service"))).toEqual([]);
    expect(findConflicts([gst], cand("CESS", true, "service"))).toEqual([]);
    expect(findConflicts([cgst], cand("CGST", true, "service"))).toHaveLength(1);
  });
  it("ignores non-tax settings rows", () => {
    const other = { ...gst, id: "9", key: "PRINT_CONFIG", value: JSON.stringify({ paper: "A4" }) };
    expect(findConflicts([other], cand("GST", true, "service"))).toEqual([]);
  });
});
