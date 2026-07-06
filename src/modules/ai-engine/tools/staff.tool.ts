import { staffService } from "../../staff/staff.service";
import { AgentContext, Tool } from "../ai-engine.types";

// The underlying staff search matches first_name/last_name/email independently, so a
// full "First Last" query (e.g. "rutuja pagale") matches neither column's substring
// and returns nothing even for a real staff member. Fetch all active staff instead
// and match against the combined full name ourselves — salons have few enough staff
// that this is cheap.
function matchesStaffSearch(fullName: string, term: string): boolean {
    const name = fullName.toLowerCase();
    const search = term.trim().toLowerCase();
    if (!search) return true;
    if (name.includes(search)) return true;
    const words = search.split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every((w) => name.includes(w));
}

export const getStaffTool: Tool = {
    name: "getStaff",
    description:
        "List active staff members at the salon. Use this to recommend a stylist by name or to resolve a staff_id before checking availability or booking — never invent a staff name.",
    parameters: {
        type: "object",
        properties: {
            search: { type: "string", description: "Optional name search, e.g. 'Priya' or 'Priya Sharma'" },
        },
    },
    async execute(args, ctx: AgentContext) {
        const result = await staffService.list(ctx.salonId, { is_active: true, limit: 100 } as any);
        const items: any[] = Array.isArray(result.data) ? result.data : [];
        const withNames = items.map((s: any) => ({
            id: s.id,
            name: [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email,
            designation: s.designation,
            specialization: s.specialization,
        }));
        const filtered = args.search
            ? withNames.filter((s) => matchesStaffSearch(s.name, String(args.search)))
            : withNames;
        return { staff: filtered };
    },
};
