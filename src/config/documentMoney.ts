// Amount formatting for server-rendered documents (receipt / payroll PDFs).
// INR keeps the exact "₹1,23,456.00" output these documents always had; any
// other currency uses the standard Intl currency style (e.g. "AED 1,234.50").
export function formatDocumentMoney(amount: number, currency?: string | null): string {
    const code = (currency || "INR").toUpperCase();
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    if (code === "INR") {
        return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2,
        }).format(value);
    } catch {
        // Unknown currency code — never let a document fail to render over formatting.
        return value.toFixed(2);
    }
}
