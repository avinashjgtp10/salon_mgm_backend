// Where, in SalonOx, the full table behind a report chart lives. LUNOX points people here instead of rebuilding the chart or
// the table in chat. Every entry mirrors a real report in the frontend's ReportsPage (same name, same category label) and
// each of these reports has the Table View / Chart View switch, so the detailed rows are one click away from its chart.
// Keep this list to reports that exist: an invented path is worse than no path.

export interface ReportLocation {
    /** The report's name exactly as the Reports screen shows it. */
    report: string;
    /** The category tab it sits under on the Reports screen. */
    category: string;
    /** Chart subjects this report's charts cover — what a person might call the chart. */
    topics: string[];
}

export const REPORT_LOCATIONS: ReportLocation[] = [
    { report: "Sales Summary Report", category: "Sales", topics: ["sales", "revenue", "income", "earning", "daily sales", "sales trend", "payment method", "payment mode", "cash upi card", "top service", "top staff", "category", "item type", "bills", "invoice"] },
    { report: "Service Sale Report", category: "Sales", topics: ["service sale", "services sold", "service revenue", "service count", "average ticket", "popular service", "best selling service"] },
    { report: "Staff Sales", category: "Staff", topics: ["staff sales", "staff revenue", "revenue by staff", "staff wise", "stylist revenue"] },
    { report: "Staff Performance", category: "Staff", topics: ["staff performance", "staff commission", "staff invoices", "staff collected", "staff due"] },
    { report: "Service, Product, Membership & Package Sold by Staff", category: "Staff", topics: ["staff item", "sold by staff", "staff products", "staff memberships", "staff packages"] },
    { report: "Client Revenue Report", category: "Clients", topics: ["client revenue", "client spend", "customer spend", "visit count", "top client", "average ticket per client"] },
    { report: "Client Frequency Report", category: "Clients", topics: ["new vs returning", "new clients", "returning clients", "client frequency", "repeat clients", "retention"] },
    { report: "Service Frequency Report", category: "Clients", topics: ["service frequency", "how often clients return", "service repeat"] },
    { report: "Enquiry Report", category: "Clients", topics: ["enquiry", "enquiries", "leads", "follow up status"] },
    { report: "Payment Collection Report", category: "Payments", topics: ["payment collection", "outstanding", "pending", "due balance", "collected vs due", "receivable"] },
    { report: "Cash Management Report", category: "Payments", topics: ["cash management", "cash counter", "cash revenue", "cash expense", "opening closing balance"] },
    { report: "Product Retail Report", category: "Inventory", topics: ["product sale", "retail", "products sold", "product revenue"] },
    { report: "Product Inventory Report", category: "Inventory", topics: ["stock", "inventory", "stock value", "reorder", "on hand"] },
    { report: "Supplier Purchase History", category: "Inventory", topics: ["purchase", "supplier purchase", "purchase history"] },
    { report: "Package Sale Report", category: "Package and Membership", topics: ["package sale", "packages sold", "package revenue"] },
    { report: "Membership Sale Report", category: "Package and Membership", topics: ["membership sale", "memberships sold", "membership revenue"] },
];

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Reports whose chart subject matches `topic`, best match first (at most 3). */
export function findReportsForChart(topic: string): ReportLocation[] {
    const t = norm(topic);
    if (!t) return [];
    const words = t.split(" ").filter((w) => w.length > 2);
    const scored = REPORT_LOCATIONS.map((r) => {
        const hay = norm(`${r.report} ${r.topics.join(" ")}`);
        let score = 0;
        for (const phrase of r.topics) if (t.includes(norm(phrase))) score += 3;
        if (t.includes(norm(r.report))) score += 5;
        for (const w of words) if (hay.includes(w)) score += 1;
        return { r, score };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map((x) => x.r);
}
