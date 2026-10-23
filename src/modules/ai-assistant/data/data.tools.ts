import pool from "../../../config/database";
import { assertModuleUnlocked } from "../../../middleware/moduleLock.middleware";
import { reportsRepository } from "../../reports/reports.repository";
import { salonsRepository } from "../../salons/salons.repository";
import { AssistantUser, Tool } from "../ai-assistant.types";
import { moneyFormatter } from "./money";
import { PERIODS, ResolvedPeriod, resolvePeriod } from "./periods";

// Read-only tools for the dashboard "Ask your data" box. Money figures come from the SAME report functions the
// Reports screen uses (Sales Summary, Product Sale), with the same default filters (paid + partial sales), so an answer
// always matches what the salon sees in Reports for the same dates. The AI never writes SQL.

const norm = (s: string) =>
    String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean)
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)).join(" ");

type Option = { id: string; label: string };

// "facials" → every category/service with the word "facial" in it ("Facial", "Facial Men"…); "hair spa" → services containing
// both words. All matches are included, and the answer says which ones, so the manager sees exactly what was counted.
// `prefix` lets "cut" match "cutting" (services/categories); staff names must match whole words so "priya" ≠ "priyanka".
function matchLabels(items: Option[], term: string, prefix = true): Option[] {
    const t = norm(term);
    if (!t) return [];
    const tw = t.split(" ");
    return items.filter((i) => {
        const n = norm(i.label);
        if (n === t) return true;
        const lw = n.split(" ");
        return tw.every((w) => lw.some((l) => l === w || (prefix && w.length >= 3 && l.startsWith(w))));
    });
}

const uniq = (xs: string[]) => [...new Set(xs)];

// The salon's timezone (for "today"/"last month") and currency (for every amount we print).
async function getSalonContext(salonId: string): Promise<{ tz: string; fmt: (n: number) => string }> {
    const salon = await salonsRepository.findById(salonId);
    return { tz: salon?.timezone || "Asia/Kolkata", fmt: moneyFormatter(salon?.currency) };
}

const periodParams = {
    period: { type: "string", enum: [...PERIODS], description: "Which dates. Use 'custom' only with start_date and end_date." },
    start_date: { type: "string", description: "YYYY-MM-DD — only for period=custom" },
    end_date: { type: "string", description: "YYYY-MM-DD — only for period=custom" },
};

const periodOut = (p: ResolvedPeriod) => ({ label: p.label, from: p.start_date, to: p.end_date });

// ─── Sales (Sales Summary report) ───────────────────────────────────────────────
const getSalesReportTool: Tool = {
    name: "getSalesReport",
    description:
        "Revenue figures from the Sales Summary report for a period, optionally filtered to one service, service category, staff member, payment method or kind of item. Answers 'how much did we earn…', 'how many bills…', comparisons with the previous period, and 'which services/staff/payment methods brought in the most'.",
    permission: "view_report_sales_summary",
    parameters: {
        type: "object",
        properties: {
            ...periodParams,
            service_or_category: { type: "string", description: "A service or category name as the user said it, e.g. 'facials' or 'hair spa'. Omit for the whole salon." },
            staff: { type: "string", description: "A staff member's name as the user said it. Omit for everyone." },
            payment_mode: { type: "string", description: "Payment method as the user said it, e.g. 'cash' or 'upi'." },
            item_type: { type: "string", enum: ["service", "product", "membership", "package", "gift_card"], description: "Only this kind of item." },
            breakdown: { type: "string", enum: ["none", "services", "staff", "categories", "payment_modes", "item_types"], description: "Also rank the results by this. Use for 'top', 'best', 'which' questions." },
        },
        required: ["period"],
    },
    async execute(args, user: AssistantUser) {
        await assertModuleUnlocked(user.salonId, "reports");
        const { tz, fmt } = await getSalonContext(user.salonId);
        const per = resolvePeriod(args.period, tz, args.start_date, args.end_date);

        const avail = await reportsRepository.getSalesSummaryFiltersAvailable(user.salonId);
        const filters: Record<string, any> = {
            start_date: per.start_date, end_date: per.end_date,
            // Same default as the Sales Summary screen: only paid and partly paid sales count as revenue.
            payment_statuses: ["paid", "partial"],
        };
        const matched: Record<string, string[]> = {};

        if (args.service_or_category) {
            const term = String(args.service_or_category);
            const cats = matchLabels(avail.service_categories, term);
            if (cats.length) {
                filters.category_ids = cats.map((c) => c.id);
                matched.categories = [...new Set(cats.map((c) => c.label))];
            } else {
                const svcs = matchLabels(avail.services, term);
                if (svcs.length) {
                    filters.service_ids = svcs.map((s) => s.id);
                    matched.services = [...new Set(svcs.map((s) => s.label))];
                } else {
                    return {
                        not_found: `No service or category matching "${term}".`,
                        categories: uniq(avail.service_categories.map((c) => c.label)).slice(0, 30),
                        some_services: uniq(avail.services.map((s) => s.label)).slice(0, 30),
                    };
                }
            }
        }
        if (args.staff) {
            const people = matchLabels(avail.staff, String(args.staff), false);
            if (!people.length) return { not_found: `No staff member matching "${args.staff}" with sales.`, staff: uniq(avail.staff.map((s) => s.label)).slice(0, 30) };
            filters.staff_ids = people.map((p) => p.id);
            matched.staff = [...new Set(people.map((p) => p.label))];
        }
        if (args.payment_mode) {
            const wanted = norm(String(args.payment_mode));
            const modes = avail.payment_modes.filter((m) => norm(m).includes(wanted) || wanted.includes(norm(m)));
            if (!modes.length) return { not_found: `No payment method matching "${args.payment_mode}".`, payment_modes: avail.payment_modes };
            filters.payment_modes = modes;
            matched.payment_modes = modes;
        }
        if (["service", "product", "membership", "package", "gift_card"].includes(args.item_type)) {
            filters.item_types = [args.item_type];
            matched.item_type = [args.item_type];
        }

        const [stats, prev] = await Promise.all([
            reportsRepository.getSalesSummaryReportStats(user.salonId, filters),
            reportsRepository.getSalesSummaryPreviousPeriodStats(user.salonId, filters).catch(() => null),
        ]);

        const received = Number(stats.received_amount) || 0;
        const billed = Number(stats.total_sale) || 0;
        const bills = Number(stats.total_bill) || 0;
        const out: Record<string, unknown> = {
            period: periodOut(per),
            whole_period_totals_below: true,
            filters_applied: matched,
            money_received: fmt(received),
            total_billed: fmt(billed),
            number_of_bills: bills,
            average_bill: bills > 0 ? fmt(billed / bills) : null,
            discounts_given: fmt(Number(stats.total_discount) || 0),
            tips: fmt(Number(stats.total_tip) || 0),
            gst: fmt(Number(stats.total_gst) || 0),
        };
        if (prev) {
            const pr = Number(prev.received_amount) || 0;
            // The tool compares with the equally long window just before this one — say so, with its dates.
            const days = Math.round((new Date(`${per.end_date}T00:00:00Z`).getTime() - new Date(`${per.start_date}T00:00:00Z`).getTime()) / 86_400_000) + 1;
            const prevEnd = new Date(new Date(`${per.start_date}T00:00:00Z`).getTime() - 86_400_000);
            const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
            out.previous_period = {
                dates: `${prevStart.toISOString().slice(0, 10)} to ${prevEnd.toISOString().slice(0, 10)} (same length, just before)`,
                money_received: fmt(pr),
                change: pr > 0 ? `${received >= pr ? "+" : ""}${Math.round(((received - pr) / pr) * 1000) / 10}%` : "no earlier sales to compare",
            };
        }

        const b = String(args.breakdown ?? "none");
        // Each ranked row carries ITS OWN amount (named so it can't be confused with the period totals above).
        const top = (rows: Array<{ name: string; value: number }>) => rows.slice(0, 8).map((r, i) => ({ rank: i + 1, name: r.name, its_own_total_billed: fmt(r.value) }));
        if (b === "services") out.top_services = top((await reportsRepository.getSalesSummaryTopServices(user.salonId, filters, 8)).map((r) => ({ name: r.service_name, value: r.total_sale })));
        else if (b === "staff") out.top_staff = top((await reportsRepository.getSalesSummaryTopStaff(user.salonId, filters, 8)).map((r) => ({ name: r.staff_name, value: r.total_sale })));
        else if (b === "categories") out.by_category = top((await reportsRepository.getSalesSummaryByCategory(user.salonId, filters)).map((r) => ({ name: r.category_name, value: r.total_sale })));
        else if (b === "item_types") out.by_item_type = top((await reportsRepository.getSalesSummaryByItemType(user.salonId, filters)).map((r) => ({ name: r.item_type, value: r.total_sale })));
        else if (b === "payment_modes") {
            out.by_payment_mode = (await reportsRepository.getSalesSummaryPaymentModeBreakdown(user.salonId, filters)).map((r) => ({ payment_mode: r.payment_mode, money_received: fmt(r.received_amount) }));
        }
        return out;
    },
};

// ─── Retail product sales (Product Sale report) ──────────────────────────────────
const getProductSalesTool: Tool = {
    name: "getProductSales",
    description: "Retail product sales for a period (units sold, revenue, best-selling products), optionally for one product or brand name. Answers 'how many shampoos did we sell…' and 'which product sells best'.",
    permission: ["view_report_product_sale", "view_report_product_sale_inventory"],
    parameters: {
        type: "object",
        properties: { ...periodParams, product: { type: "string", description: "Product name or keyword as the user said it. Omit for all products." } },
        required: ["period"],
    },
    async execute(args, user: AssistantUser) {
        await assertModuleUnlocked(user.salonId, "reports");
        const { tz, fmt } = await getSalonContext(user.salonId);
        const per = resolvePeriod(args.period, tz, args.start_date, args.end_date);
        const filters: Record<string, any> = { start_date: per.start_date, end_date: per.end_date };
        if (args.product) filters.search = String(args.product).slice(0, 80);

        const [stats, topProducts] = await Promise.all([
            reportsRepository.getProductRetailReportStats(user.salonId, filters),
            reportsRepository.getProductRetailTopProducts(user.salonId, filters, 8),
        ]);
        return {
            period: periodOut(per),
            filters_applied: args.product ? { product_keyword: String(args.product) } : {},
            units_sold: Number(stats.total_quantity) || 0,
            revenue: fmt(Number(stats.total_revenue) || 0),
            different_products_sold: Number(stats.unique_products) || 0,
            best_sellers: topProducts.map((p) => ({ product: p.product_name, units: Number(p.quantity) || 0, revenue: fmt(Number(p.revenue) || 0) })),
        };
    },
};

// ─── Appointments (count by status) ─────────────────────────────────────────────
const getAppointmentCountsTool: Tool = {
    name: "getAppointmentCounts",
    description: "How many appointments there were in a period, split by status (booked, paid, cancelled, no-show…). Answers 'how many appointments last week' and 'how many no-shows this month'.",
    permission: "view_calendar",
    parameters: { type: "object", properties: { ...periodParams }, required: ["period"] },
    async execute(args, user: AssistantUser) {
        await assertModuleUnlocked(user.salonId, "calendar");
        const { tz } = await getSalonContext(user.salonId);
        const per = resolvePeriod(args.period, tz, args.start_date, args.end_date);
        const { rows } = await pool.query(
            `SELECT LOWER(a.status::text) AS status, COUNT(*)::int AS n
             FROM appointments a
             WHERE a.salon_id = $1 AND a.deleted_at IS NULL AND LOWER(a.status::text) <> 'deleted'
               AND (a.scheduled_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
             GROUP BY 1 ORDER BY n DESC`,
            [user.salonId, tz, per.start_date, per.end_date]
        );
        return { period: periodOut(per), total: rows.reduce((s, r) => s + r.n, 0), by_status: rows.map((r) => ({ status: r.status, count: r.n })) };
    },
};

// ─── New clients ────────────────────────────────────────────────────────────────
const getNewClientsTool: Tool = {
    name: "getNewClients",
    description: "How many new clients were added in a period. Answers 'how many new customers this month'.",
    permission: "view_clients",
    parameters: { type: "object", properties: { ...periodParams }, required: ["period"] },
    async execute(args, user: AssistantUser) {
        await assertModuleUnlocked(user.salonId, "clients");
        const { tz } = await getSalonContext(user.salonId);
        const per = resolvePeriod(args.period, tz, args.start_date, args.end_date);
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM clients c
             WHERE c.salon_id = $1 AND (c.created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`,
            [user.salonId, tz, per.start_date, per.end_date]
        );
        return { period: periodOut(per), new_clients: rows[0]?.n ?? 0 };
    },
};

export const dataTools: Tool[] = [getSalesReportTool, getProductSalesTool, getAppointmentCountsTool, getNewClientsTool];
export const findDataTool = (name: string) => dataTools.find((t) => t.name === name);
