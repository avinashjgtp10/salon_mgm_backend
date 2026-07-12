import { clientsRepository } from "../../clients/clients.repository";
import { clientsService } from "../../clients/clients.service";
import { appointmentsRepository } from "../../appointments/appointments.repository";
import { Client } from "../../clients/clients.types";
import { AgentContext, Tool } from "../ai-engine.types";

// ─── Phone splitting ─────────────────────────────────────────────────────────
// WhatsApp phones arrive as E.164 (e.g. "+919876543210"). Indian numbers are
// split into country code + local number to match the exact-match path in
// findExistingByEmailOrPhone; anything else falls back to its best-effort
// phone-number-only match.
export function splitPhone(e164Phone: string): { phone_country_code: string | null; phone_number: string } {
    const digits = e164Phone.replace(/[^0-9]/g, "");
    if (e164Phone.startsWith("+91") && digits.length === 12) {
        return { phone_country_code: "+91", phone_number: digits.slice(2) };
    }
    return { phone_country_code: null, phone_number: digits };
}

// ─── Internal helper (not LLM-exposed) — resolves/creates the client identity
// for an inbound WhatsApp conversation, before the tool-call loop starts. ─────
export async function resolveClient(
    salonId: string,
    phone: string,
    name: string | null
): Promise<Client> {
    const { phone_country_code, phone_number } = splitPhone(phone);

    const existing = await clientsRepository.findExistingByEmailOrPhone(
        { phone_country_code, phone_number },
        salonId
    );
    if (existing) return existing;

    const created = await clientsService.create(
        {
            first_name: name?.trim() || "WhatsApp Customer",
            phone_country_code: phone_country_code ?? "+91",
            phone_number,
            client_source: "whatsapp_ai",
        },
        salonId
    );
    return created;
}

// ─── LLM-exposed tool ────────────────────────────────────────────────────────
export const getCustomerHistoryTool: Tool = {
    name: "getCustomerHistory",
    description:
        "Get this customer's past and upcoming appointment history at this salon. Use this before recommending a stylist or service if the customer seems to be a returning customer.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        if (!ctx.clientId) {
            return { is_new_customer: true, appointments: [] };
        }
        const appointments = await appointmentsRepository.listByClientId(ctx.clientId);
        return {
            is_new_customer: appointments.length === 0,
            appointments: appointments.slice(0, 10).map((a) => ({
                id: a.id,
                status: a.status,
                scheduled_at: a.scheduled_at,
                services: a.services?.map((s) => s.name) ?? [],
                staff_id: a.staff_id,
            })),
        };
    },
};
