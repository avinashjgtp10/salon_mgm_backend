// A business tax-registration number as stored in salons.gst_number / clients.gst_number /
// suppliers.gstin: an Indian GSTIN (2-digit state code + 10-char PAN + entity digit + "Z" +
// checksum) or a UAE TRN (15 digits). The two can never be confused — a GSTIN always has letters,
// a TRN has none — so one check serves both without needing to know the record's country.
export const GSTIN_FORMAT_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const TRN_FORMAT_RE = /^[0-9]{15}$/;

export function isValidTaxRegistrationNumber(value: string): boolean {
    const v = String(value ?? "").trim().toUpperCase();
    return GSTIN_FORMAT_RE.test(v) || TRN_FORMAT_RE.test(v);
}

export const TAX_ID_ERROR = "must be a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5) or a 15-digit TRN";
