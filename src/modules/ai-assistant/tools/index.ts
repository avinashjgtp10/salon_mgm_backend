import pool from "../../../config/database";
import { servicesService } from "../../services/services.service";
import { productsRepository } from "../../products/products.repository";
import { staffService } from "../../staff/staff.service";
import { salonsRepository } from "../../salons/salons.repository";
import { AssistantUser, Tool } from "../ai-assistant.types";
import { recommendProductsForService } from "../recommendations.service";

// Every tool is read-only and salon-scoped: salonId always comes from the
// signed-in user, never from model output. `permission` is enforced by the
// service before execute() runs.

export const SERVICE_VIEW_PERMS = ["view_services", "create_sales", "create_appointment", "manage_calendar"];

const getServicesTool: Tool = {
    name: "getServices",
    description: "List the salon's active services with price and duration. Use for any question about what the salon offers or charges.",
    permission: SERVICE_VIEW_PERMS,
    parameters: {
        type: "object",
        properties: { search: { type: "string", description: "Optional keyword, e.g. 'hair spa'" } },
    },
    async execute(args, user: AssistantUser) {
        const result = await servicesService.list(
            { search: args.search ? String(args.search) : undefined, status: "active", page: 1, limit: 30 },
            user.salonId
        );
        return {
            services: result.data.map((s) => ({
                id: s.id, name: s.name, category: s.category_name, price: s.price, duration_minutes: s.duration,
            })),
        };
    },
};

const getProductsTool: Tool = {
    name: "getProducts",
    description: "List the salon's products with price and stock. Use for product, price or stock questions.",
    permission: "view_products",
    parameters: {
        type: "object",
        properties: {
            search: { type: "string", description: "Optional keyword" },
            stock: { type: "string", enum: ["all", "low", "in_stock", "out_of_stock"] },
        },
    },
    async execute(args, user: AssistantUser) {
        const stock = ["all", "low", "in_stock", "out_of_stock"].includes(args.stock) ? args.stock : "all";
        const { data, total } = await productsRepository.list(
            { search: args.search ? String(args.search) : undefined, stock, limit: 30 },
            user.salonId
        );
        return {
            total,
            products: data.map((p) => ({
                id: p.id, name: p.name, description: p.short_description ?? p.description,
                retail_price: p.retail_price, retail_sales_enabled: p.retail_sales_enabled, in_stock: p.amount > 0,
            })),
        };
    },
};

const getStaffTool: Tool = {
    name: "getStaff",
    description: "List active staff members (name and designation).",
    parameters: { type: "object", properties: {} },
    async execute(_args, user: AssistantUser) {
        const result = await staffService.list(user.salonId, { is_active: true, limit: 100 } as any);
        const items: any[] = Array.isArray(result.data) ? result.data : [];
        return {
            staff: items.map((s) => ({
                id: s.id,
                name: [s.first_name, s.last_name].filter(Boolean).join(" ").trim(),
                designation: s.designation,
            })),
        };
    },
};

const getTodaysAppointmentsTool: Tool = {
    name: "getTodaysAppointments",
    description: "List today's appointments (time, client, staff, status) in the salon's own timezone.",
    permission: "view_calendar",
    parameters: { type: "object", properties: {} },
    async execute(_args, user: AssistantUser) {
        const salon = await salonsRepository.findById(user.salonId);
        const tz = salon?.timezone || "Asia/Kolkata";
        const { rows } = await pool.query(
            `SELECT a.id, a.scheduled_at, a.status, a.duration_minutes,
                    c.first_name AS client_first, c.last_name AS client_last,
                    st.first_name AS staff_first, st.last_name AS staff_last
             FROM appointments a
             LEFT JOIN clients c ON c.id = a.client_id
             LEFT JOIN staff st ON st.id = a.staff_id
             WHERE a.salon_id = $1
               AND LOWER(a.status::text) NOT IN ('cancelled', 'deleted')
               AND (a.scheduled_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
             ORDER BY a.scheduled_at ASC
             LIMIT 100`,
            [user.salonId, tz]
        );
        return {
            timezone: tz,
            count: rows.length,
            appointments: rows.map((r) => ({
                id: r.id,
                time: new Date(r.scheduled_at).toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }),
                status: r.status,
                duration_minutes: r.duration_minutes,
                client: [r.client_first, r.client_last].filter(Boolean).join(" ") || null,
                staff: [r.staff_first, r.staff_last].filter(Boolean).join(" ") || null,
            })),
        };
    },
};

const recommendProductsTool: Tool = {
    name: "recommendProducts",
    description: "Recommend in-stock retail products to sell with a given service, with benefits, usage and a ready-to-say sales pitch. Call getServices first to get the real service id. Present the result clearly to the manager.",
    permission: SERVICE_VIEW_PERMS,
    parameters: {
        type: "object",
        properties: { service_id: { type: "string", description: "A real service id from getServices" } },
        required: ["service_id"],
    },
    execute: (args, user) => recommendProductsForService(user, args.service_id),
};

export const assistantTools: Tool[] = [getServicesTool, recommendProductsTool, getProductsTool, getStaffTool, getTodaysAppointmentsTool];

export const findTool = (name: string) => assistantTools.find((t) => t.name === name);
