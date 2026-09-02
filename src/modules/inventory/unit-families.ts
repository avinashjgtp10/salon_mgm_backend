// Unit Conversion system: inventory is always stored/deducted in the
// product's Base Unit (products.measure_unit); staff can log usage in any
// configured Display Unit, converted to the base unit automatically. A
// Display Unit is only ever valid within the SAME measurement family as the
// base unit — this registry is the single source of truth for that,
// mirrored on the frontend (features/catalog/utils/unitFamilies.ts) for the
// Add/Edit Consumable form's dropdown; this copy is what actually gets
// enforced server-side.

export type UnitFamily = "volume" | "weight" | "count";

export function getUnitFamily(baseUnit: string): UnitFamily {
  const u = (baseUnit || "").toLowerCase();
  if (u === "ml" || u === "l") return "volume";
  if (u === "g" || u === "gm" || u === "kg") return "weight";
  return "count"; // pcs, and anything else not otherwise recognized
}

export interface CompatibleUnit {
  name: string;
  // System-defined conversion (e.g. "1 L = 1000 ml") — not product-specific,
  // never user-editable. Packaging units (Bottle, Tube, Sachet, ...) have no
  // fixedRatio: their size genuinely varies per product/package.
  fixedRatio?: number;
}

const FAMILY_UNITS: Record<UnitFamily, CompatibleUnit[]> = {
  volume: [
    { name: "L", fixedRatio: 1000 },
    { name: "Bottle" },
    { name: "Tube" },
    { name: "Sachet" },
    { name: "Cup" },
    { name: "Jar" },
  ],
  weight: [
    { name: "kg", fixedRatio: 1000 },
    { name: "Packet" },
    { name: "Jar" },
  ],
  count: [
    { name: "Box" },
    { name: "Roll" },
  ],
};

export const FAMILY_MESSAGE =
  "Invalid Unit Conversion — you can only convert units within the same measurement family. " +
  "Volume: ml ↔ L. Weight: gm ↔ kg. Count: pcs.";

export function getCompatibleUnits(baseUnit: string): CompatibleUnit[] {
  return FAMILY_UNITS[getUnitFamily(baseUnit)];
}

// Case-insensitive: "l"/"L", "Bottle"/"bottle" all valid input.
export function findCompatibleUnit(baseUnit: string, unitName: string): CompatibleUnit | null {
  const needle = unitName.trim().toLowerCase();
  return getCompatibleUnits(baseUnit).find((u) => u.name.toLowerCase() === needle) ?? null;
}

// How many base-unit units does 1 `enteredUnit` equal, for a product whose
// base unit is `baseUnit` and whose product-specific packaging sizes are
// `productConversions` (its product_unit_conversions rows)? Returns null —
// never a guessed ratio — when the unit can't be resolved: either it's
// outside baseUnit's measurement family entirely (e.g. ml -> pcs, rejected
// by findCompatibleUnit), or it's a packaging unit (Bottle, Tube, ...) this
// specific product has never had configured. Callers must treat null as a
// hard rejection, not a silent 1:1 fallback — that fallback is exactly the
// bug this function exists to close (a "1 L" entry silently deducted as if
// it were "1 ml").
export function resolveConversionRatio(
  baseUnit: string,
  enteredUnit: string | null | undefined,
  productConversions: { unit_name: string; conversion_to_base: number }[]
): number | null {
  const entered = (enteredUnit ?? "").trim();
  if (!entered || entered.toLowerCase() === baseUnit.trim().toLowerCase()) return 1;

  const compatible = findCompatibleUnit(baseUnit, entered);
  if (!compatible) return null;
  if (compatible.fixedRatio !== undefined) return compatible.fixedRatio;

  const match = productConversions.find(
    (c) => c.unit_name.trim().toLowerCase() === entered.toLowerCase()
  );
  return match ? Number(match.conversion_to_base) : null;
}
