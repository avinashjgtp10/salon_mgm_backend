// Shared formatting for the SalonOx -> salon subscription tax invoice.

// The seller on every subscription invoice is SalonOx itself (not the salon: contrast with the salon's own client
// invoices, where the SALON is the seller). Carried over unchanged from the original billing feature — keep it in
// step with the company's real GST details.
export const SELLER = {
    name: "Salonox Tech",
    address: "Salonox Tech, JI tower, Bhigwan Baramati Road, Baramati, Pune-413102",
    gst_number: "27ASPPJ5781N1ZT",
    pan: "ASPPJ5781N",
} as const;

export const BILLING_CYCLE_LABEL: Record<string, string> = {
    monthly: "Monthly Plan",
    quarterly: "Quarterly Plan",
    yearly: "Yearly Plan",
    annual: "Yearly Plan",
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Indian financial year (April-March) as "2627" for Apr 2026 - Mar 2027.
export function financialYearCode(d: Date): string {
    const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const threeDigits = (n: number): string => (n < 100 ? twoDigits(n) : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " + twoDigits(n % 100) : ""}`);

export function amountInWords(n: number): string {
    const rupees = Math.floor(n);
    const paise = Math.round((n - rupees) * 100);
    if (rupees === 0 && paise === 0) return "Rupees Zero Only";
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const hundred = rupees % 1000;
    const parts: string[] = [];
    if (crore) parts.push(`${threeDigits(crore)} Crore`);
    if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
    if (hundred) parts.push(threeDigits(hundred));
    const rupeeText = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
    return paise ? `${rupeeText} and ${twoDigits(paise)} Paise Only` : `${rupeeText} Only`;
}
