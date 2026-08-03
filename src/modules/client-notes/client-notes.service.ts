import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "../clients/clients.repository";
import { clientNotesRepository } from "./client-notes.repository";
import { ClientNote, CreateClientNoteBody, UpdateClientNoteBody } from "./client-notes.types";

async function _ensureClient(clientId: string, salonId: string): Promise<void> {
  const client = await clientsRepository.findById(clientId, salonId);
  if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
}

export const clientNotesService = {
  async list(clientId: string, salonId: string): Promise<ClientNote[]> {
    await _ensureClient(clientId, salonId);
    return clientNotesRepository.listByClientId(clientId);
  },

  async create(
    clientId: string, salonId: string, staffId: string | null, data: CreateClientNoteBody,
  ): Promise<ClientNote> {
    await _ensureClient(clientId, salonId);
    if (!data.note?.trim()) throw new AppError(400, "note is required", "VALIDATION_ERROR");
    return clientNotesRepository.create(salonId, clientId, staffId, data);
  },

  async update(
    clientId: string, salonId: string, id: string, patch: UpdateClientNoteBody,
  ): Promise<ClientNote> {
    await _ensureClient(clientId, salonId);
    if (!patch.note?.trim()) throw new AppError(400, "note is required", "VALIDATION_ERROR");
    const updated = await clientNotesRepository.update(id, clientId, patch);
    if (!updated) throw new AppError(404, "Note not found", "NOT_FOUND");
    return updated;
  },

  async delete(clientId: string, salonId: string, id: string): Promise<void> {
    await _ensureClient(clientId, salonId);
    const deleted = await clientNotesRepository.delete(id, clientId);
    if (!deleted) throw new AppError(404, "Note not found", "NOT_FOUND");
  },
};
