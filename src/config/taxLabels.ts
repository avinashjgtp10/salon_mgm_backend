import { normalizeCountryCode } from "./salonTimezone";

// Tax wording for server-rendered documents. The UAE uses VAT + a TRN; every other country keeps
// the GST/GSTIN wording these documents have always used (so nothing changes for India).
export interface DocTaxLabels {
    isVat: boolean;
    taxName: string;        // "VAT" | "GST"
    taxIdLabel: string;     // salon's registration number: "TRN" | "GSTIN"
    clientTaxIdLabel: string; // client's registration number: "TRN" | "GST No"
}

export function docTaxLabels(country: string | null | undefined): DocTaxLabels {
    const isVat = normalizeCountryCode(country) === "AE";
    return isVat
        ? { isVat, taxName: "VAT", taxIdLabel: "TRN", clientTaxIdLabel: "TRN" }
        : { isVat, taxName: "GST", taxIdLabel: "GSTIN", clientTaxIdLabel: "GST No" };
}
