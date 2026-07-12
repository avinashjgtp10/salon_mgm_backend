import { notificationsService } from "../../notifications/notifications.service";
import { AgentContext, Tool } from "../ai-engine.types";

export const handoffToReceptionistTool: Tool = {
    name: "handoffToReceptionist",
    description:
        "Escalate this conversation to a human receptionist. Call this whenever you are uncertain, a tool fails, the request is out of scope (e.g. a complaint, a refund, something none of your tools cover), or the customer explicitly asks for a human.",
    parameters: {
        type: "object",
        properties: {
            reason: { type: "string", description: "Short reason for the handoff, for the staff notification" },
        },
        required: ["reason"],
    },
    async execute(args, ctx: AgentContext) {
        await notificationsService.create({
            salon_id: ctx.salonId,
            type: "ai_handoff",
            title: `LUNOX needs a human — ${ctx.customerName ?? ctx.phone}`,
            body: args.reason,
        });
        return { handed_off: true };
    },
};
