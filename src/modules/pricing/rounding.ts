import pool from "../../config/database";

// Bills have always been rounded to a WHOLE currency unit, with the difference shown as a "Round Off"
// line — right for rupees, wrong for the dirham: a UAE tax invoice must reconcile exactly to net + VAT,
// and AED has 100 fils. Currencies listed here round to that finer unit; every other currency keeps
// whole-unit rounding exactly as before, so nothing changes for existing salons.
const ROUNDING_UNIT_BY_CURRENCY: Record<string, number> = {
    AED: 0.01,
};

export function roundingUnitForCurrency(code: string | null | undefined): number {
    return ROUNDING_UNIT_BY_CURRENCY[String(code ?? "").toUpperCase()] ?? 1;
}

// Rounds to the nearest `unit` (1 => whole units, 0.01 => fils). Exact for 1; otherwise guards against
// floating-point residue like 105.00000000000001.
export function roundToUnit(value: number, unit: number = 1): number {
    if (unit === 1) return Math.round(value);
    return Number((Math.round(value / unit) * unit).toFixed(6));
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { unit: number; at: number }>();

// The rounding unit for a salon's bills, from salons.currency (cached briefly — it is read on every
// checkout/price preview). Never throws: any lookup problem falls back to whole-unit rounding.
export async function getBillRoundingUnit(salonId: string): Promise<number> {
    const hit = cache.get(salonId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.unit;
    let unit = 1;
    try {
        const { rows } = await pool.query(`SELECT currency FROM salons WHERE id = $1`, [salonId]);
        unit = roundingUnitForCurrency(rows[0]?.currency);
    } catch {
        // fall through to whole-unit rounding
    }
    cache.set(salonId, { unit, at: Date.now() });
    return unit;
}
