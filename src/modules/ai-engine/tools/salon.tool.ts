import { salonsRepository } from "../../salons/salons.repository";
import { branchesRepository } from "../../branches/branches.repository";
import { AgentContext, Tool } from "../ai-engine.types";

export const getSalonDetailsTool: Tool = {
    name: "getSalonDetails",
    description:
        "Get the salon's name, address, phone, and branch timings. Use this to answer questions about location, contact info, or opening/closing hours.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        const salon = await salonsRepository.findById(ctx.salonId);
        if (!salon) return { found: false };

        const branches = await branchesRepository.listBySalonId(ctx.salonId);
        const mainBranch = branches.find((b) => b.is_main) ?? branches[0] ?? null;

        return {
            found: true,
            business_name: salon.business_name,
            phone: salon.phone,
            email: salon.email,
            branches: branches.map((b) => ({
                name: b.name,
                address: `${b.address_line1}${b.address_line2 ? ", " + b.address_line2 : ""}, ${b.city}, ${b.state} ${b.pincode}`,
                phone: b.phone,
                opening_time: b.opening_time,
                closing_time: b.closing_time,
                is_main: b.is_main,
            })),
            default_branch: mainBranch
                ? { name: mainBranch.name, opening_time: mainBranch.opening_time, closing_time: mainBranch.closing_time }
                : null,
        };
    },
};
