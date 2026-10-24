import helpTopics from "./knowledge/help-topics.json";
import tourGuides from "./knowledge/tour-guides.json";

type Doc = { id: string; title: string; text: string };

const STOP = new Set([
    "the", "a", "an", "to", "how", "do", "i", "is", "in", "of", "and", "for", "my", "can", "on", "it", "me", "what", "does", "with",
    "this", "that", "are", "be", "you", "we", "our", "your", "new", "use", "make", "set", "get", "see", "show", "enable", "mode", "salonox", "salon", "please", "want", "need",
]);

// Light stemming so "clients" matches "client", "bookings" matches "booking", "packages" matches "package".
const stem = (w: string) => (w.length > 4 ? w.replace(/ies$/, "y").replace(/(es|s|ing|ed)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

type TourGuide = { id: string; label: string; path: string; steps: Array<{ title: string; description: string }> };

// Words a manager actually types that the tour titles don't contain. Matched like a title word.
const ALIASES: Record<string, string> = {
    calendar: "appointment book booking schedule reschedule slot block",
    quick_sale: "sale bill billing checkout invoice payment split tip walk-in",
    dashboard: "home overview projection target collection summary",
    clients: "customer client add import export merge",
    catalog_services: "service menu price duration",
    catalog_products: "product retail sell stock",
    catalog_packages: "package session sell",
    catalog_memberships: "membership member plan",
    staff_members: "staff employee team add",
    staff_attendance: "attendance check-in checkin present absent",
    staff_commissions: "commission incentive target",
    staff_payroll: "payroll salary pay payrun",
    marketing_campaigns: "campaign broadcast whatsapp send bulk message",
    marketing_templates: "template message approval meta whatsapp",
    marketing_inbox: "inbox reply chat conversation whatsapp",
    reports: "report analytics export",
    settings: "setting configure permission role account",
    settings_billing: "billing plan subscription invoice",
    cash_management: "cash register counter drawer expense",
    online_booking: "online booking website link",
    enquiries: "enquiry lead follow-up",
};

// The in-app guided tours, as the chat assistant's source of truth for "how do I…" (regenerate with
// salon_mgm_frontend/scripts/export-lunox-guides.mjs after changing a tour). Capped per article to keep prompts small.
const MAX_DOC_CHARS = 1800;
const guideDocs: Array<Doc & { alias: string }> = (tourGuides as TourGuide[]).map((g) => {
    const text = `Open it from the ${g.label} section of the SalonOx sidebar. ` + g.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`).join(" ");
    return { id: `guide:${g.id}`, title: g.label, alias: ALIASES[g.id] ?? "", text: text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + "…" : text };
});

async function loadDocs(): Promise<Array<Doc & { alias?: string }>> {
    const help = (helpTopics as Array<{ id: string; title: string; text: string }>).map((h) => ({ id: `help:${h.id}`, title: h.title, text: h.text }));
    return [...guideDocs, ...help];
}

export async function retrieveKnowledge(question: string, k = 4): Promise<Doc[]> {
    const q = new Set(tokens(question));
    if (q.size === 0) return [];
    const docs = await loadDocs();
    const scored = docs.map((d) => {
        const title = new Set([...tokens(d.title), ...tokens(d.alias ?? "")]);
        const body = new Set(tokens(d.text));
        let score = 0;
        let matched = 0;
        for (const w of q) {
            const inTitle = title.has(w);
            const inBody = body.has(w);
            if (inTitle) score += 3;
            if (inBody) score += 1;
            if (inTitle || inBody) matched += 1;
        }
        return { d, score, matched };
    });
    // Needs a real match (a title/alias hit, or two different words in the body) so a stray word doesn't pull in a random article.
    return scored
        .filter((s) => s.score >= 3 || s.matched >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((s) => s.d);
}
