// Indian financial year runs Apr 1 – Mar 31, formatted "2026-27" the way the
// invoice number ("FY2026-27/041") expects.
export function financialYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed; April = 3
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}
