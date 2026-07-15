import { aiEngineRepository } from "../ai-engine.repository";
import { AgentContext, Tool } from "../ai-engine.types";

export const updateCustomerMemoryTool: Tool = {
    name: "updateCustomerMemory",
    description:
        "Save something worth remembering about this customer for future conversations — e.g. their preferred stylist, preferred language, birthday, or a note like an allergy or a preference they mentioned (\"prefers a quiet chair\", \"allergic to ammonia\"). Call this whenever the customer shares something like that, even mid-conversation. Notes accumulate — each call adds to what's already known rather than replacing it.",
    parameters: {
        type: "object",
        properties: {
            preferred_staff_id: { type: "string", description: "Staff id (from getStaff) this customer prefers" },
            preferred_language: { type: "string", description: "e.g. Hindi, Marathi, English" },
            birthday: { type: "string", description: "YYYY-MM-DD" },
            note: { type: "string", description: "A short fact worth remembering, e.g. an allergy or preference" },
        },
    },
    async execute(args, ctx: AgentContext) {
        if (!args.preferred_staff_id && !args.preferred_language && !args.birthday && !args.note) {
            return { saved: false, reason: "Nothing to save" };
        }
        await aiEngineRepository.upsertMemory({
            salonId: ctx.salonId,
            phone: ctx.phone,
            clientId: ctx.clientId,
            preferredStaffId: args.preferred_staff_id,
            preferredLanguage: args.preferred_language,
            birthday: args.birthday,
            notes: args.note,
        });
        return { saved: true };
    },
};
