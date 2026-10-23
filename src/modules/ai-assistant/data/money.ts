// Formats money in the SALON's own currency (Settings → Profile), the same way the screens do, so LUNOX never
// shows ₹ to a salon that works in another currency.
const LOCALES: Record<string, string> = { INR: "en-IN", AED: "en-AE", USD: "en-US", GBP: "en-GB", EUR: "en-IE", SAR: "en-SA", SGD: "en-SG", AUD: "en-AU", CAD: "en-CA" };

export function moneyFormatter(currencyCode?: string | null): (n: number) => string {
    const code = /^[A-Z]{3}$/.test(String(currencyCode ?? "").toUpperCase()) ? String(currencyCode).toUpperCase() : "INR";
    const locale = LOCALES[code] ?? "en-US";
    let nf: Intl.NumberFormat;
    try {
        nf = new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 2 });
    } catch {
        nf = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
    }
    // Intl pads whole amounts to .00 only when asked; keep ₹3,47,993 style (no trailing .00) like the rest of the app's chat answers.
    return (n: number) => nf.format(Math.round((Number(n) || 0) * 100) / 100).replace(/\.00$/, "");
}
