import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "../clients/clients.repository";
import { clientCommunicationRepository } from "./client-communication.repository";
import { ClientCommunicationEntry } from "./client-communication.types";

export const clientCommunicationService = {
  async list(clientId: string, salonId: string): Promise<ClientCommunicationEntry[]> {
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

    // Digits-only, matching how wa_campaign_contacts.phone / wa_automation_logs.phone_number
    // are normalized elsewhere in this codebase (see formatPhone() usage in
    // whatsapp-automation.repository.ts) — strips a leading country code cleanly
    // since only the digit SUFFIX needs to match.
    const clientPhoneDigits = (client.phone_number || "").replace(/\D/g, "") || null;

    return clientCommunicationRepository.listForClient(clientId, salonId, clientPhoneDigits);
  },
};
