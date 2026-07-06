import { clientMembershipsRepository } from "../../client-memberships/client-memberships.repository";
import { clientPackagesRepository } from "../../client-packages/client-packages.repository";
import { membershipsService } from "../../memberships/memberships.service";
import { packageTemplatesService } from "../../package-templates/package-templates.service";
import { AgentContext, Tool } from "../ai-engine.types";

export const getMembershipAndPackageStatusTool: Tool = {
    name: "getMembershipAndPackageStatus",
    description:
        "Check this customer's active memberships and packages (remaining sessions/credits, expiry). Use this before answering whether a service is covered or discounted.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        if (!ctx.clientId) {
            return { memberships: [], packages: [] };
        }

        const [memberships, packages] = await Promise.all([
            clientMembershipsRepository.list(ctx.salonId, { clientId: ctx.clientId, status: "active" } as any),
            clientPackagesRepository.list(ctx.salonId, { clientId: ctx.clientId, status: "active" } as any),
        ]);

        return {
            memberships: memberships.items.map((m: any) => ({
                name: m.membershipName ?? m.membership_name,
                total_sessions: m.totalSessions ?? m.total_sessions,
                used_sessions: m.usedSessions ?? m.used_sessions,
                expires_at: m.expiresAt ?? m.expires_at,
            })),
            packages: packages.items.map((p: any) => ({
                name: p.packageName ?? p.package_name,
                status: p.status,
            })),
        };
    },
};

export const getMembershipAndPackagePlansTool: Tool = {
    name: "getMembershipAndPackagePlans",
    description:
        "List the membership plans and service packages this salon sells (name, price, sessions included, validity). Use this to explain or recommend a membership/package to a customer who doesn't have one yet — never guess what's included or how much it costs.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        const [memberships, packages] = await Promise.all([
            membershipsService.listAll({}, ctx.salonId),
            packageTemplatesService.list(ctx.salonId),
        ]);

        return {
            memberships: memberships.map((m: any) => ({
                name: m.name,
                description: m.description,
                session_type: m.sessionType ?? m.session_type,
                number_of_sessions: m.numberOfSessions ?? m.number_of_sessions,
                valid_for: m.validFor ?? m.valid_for,
                price: m.price,
            })),
            packages: packages.map((p) => ({
                name: p.name,
                price: p.basePrice,
                expiry_months: p.neverExpires ? null : p.expiryMonths,
                never_expires: p.neverExpires,
                services: p.services.map((s) => ({ name: s.serviceName, sessions: s.totalSessions })),
            })),
        };
    },
};
