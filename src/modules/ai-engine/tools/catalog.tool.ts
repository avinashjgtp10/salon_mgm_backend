import pool from "../../../config/database";
import { servicesService } from "../../services/services.service";
import { AgentContext, Tool } from "../ai-engine.types";

// Above this many active services with no search/category filter, we refuse to
// dump the raw list and hand back categories instead — a WhatsApp customer
// can't usefully read 100+ services in one message.
const NO_FILTER_CATEGORY_THRESHOLD = 15;

async function fetchCategoriesWithCounts(salonId: string) {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, COUNT(s.id)::int AS service_count
         FROM service_categories c
         LEFT JOIN services s ON s.category_id = c.id AND s.is_active = true
         WHERE c.salon_id = $1 AND c.is_active = true
         GROUP BY c.id, c.name
         HAVING COUNT(s.id) > 0
         ORDER BY c.display_order ASC, c.name ASC`,
        [salonId]
    );
    return rows as { id: string; name: string; service_count: number }[];
}

// Customers often reply by copy-pasting LUNOX's own formatted line back
// ("Haircut (30 mins): ₹500.00 (Female)"), which breaks a plain ILIKE match
// against the real service name. Strip the parts that aren't part of the name.
function sanitizeSearchTerm(raw: string): string {
    return raw
        .replace(/₹\s*[\d,]+(\.\d+)?/g, " ")
        .replace(/\([^)]*\)/g, " ")
        .replace(/\s*:\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export const getServiceCategoriesTool: Tool = {
    name: "getServiceCategories",
    description:
        "List the salon's service categories (e.g. Hair, Skin, Nails) with how many active services are in each. Call this FIRST when a customer asks broadly what services/treatments are offered — then ask which category they want before calling getServices with that category_id. Skip this and call getServices directly if the customer already named a specific service or category.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        return { categories: await fetchCategoriesWithCounts(ctx.salonId) };
    },
};

export const getServicesTool: Tool = {
    name: "getServices",
    description:
        "List the salon's active services with real pricing, duration, and description. Use this to explain what a service is, recommend one, or answer any question about what's offered or how much it costs — never guess a price or make up what a service includes. If the salon has many categories, prefer calling getServiceCategories first and passing category_id here rather than fetching everything at once.",
    parameters: {
        type: "object",
        properties: {
            search: { type: "string", description: "Optional keyword to filter services, e.g. 'haircut' or 'colour'" },
            category_id: { type: "string", description: "Optional category id (from getServiceCategories) to scope results to one category" },
        },
    },
    async execute(args, ctx: AgentContext) {
        const search = args.search ? sanitizeSearchTerm(String(args.search)) : undefined;

        if (!search && !args.category_id) {
            const categories = await fetchCategoriesWithCounts(ctx.salonId);
            const total = categories.reduce((sum, c) => sum + c.service_count, 0);
            if (total > NO_FILTER_CATEGORY_THRESHOLD) {
                return {
                    too_many_to_list: true,
                    total_active_services: total,
                    categories,
                    instruction:
                        "Do not list individual services. Tell the customer the total count and category names, ask which category they want, then call getServices again with that category_id.",
                };
            }
        }

        const result = await servicesService.list(
            { search, category_id: args.category_id, status: "active", page: 1, limit: 30 },
            ctx.salonId
        );
        const services = result.data.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category_name,
            description: s.description,
            price_type: s.price_type,
            price: s.price,
            duration_minutes: s.duration,
        }));

        // A free-text search term matching more than one real service (e.g. a
        // salon with no plain "Haircut" but six priced variants of it) is
        // exactly how a vague customer request silently turns into a random
        // pick with a fabricated-looking price. Force disambiguation
        // structurally here rather than relying on the model to remember a
        // system-prompt instruction every time — this doesn't apply to a
        // category_id browse, where multiple results are the point.
        if (search && services.length > 1) {
            return {
                multiple_matches: true,
                services,
                instruction:
                    `The customer's search "${search}" matches ${services.length} different real services — do NOT pick one yourself. List these exact names with their prices and ask which one they mean before calling any other tool (checkAvailability, createAppointment, etc.) or saying anything is booked/confirmed.`,
            };
        }

        return { services };
    },
};
