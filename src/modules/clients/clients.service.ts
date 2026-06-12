// src/modules/clients/clients.service.ts
import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "./clients.repository";
import {
    Client,
    ClientWithRelations,
    CreateClientBody,
    UpdateClientBody,
    ClientsListQuery,
    ClientsImportMode,
    ClientsImportResult,
    ClientsMergeBody,
    MergeStrategy,
} from "./clients.types";

const safeTrim = (v: any) => (v === null || v === undefined ? v : String(v).trim());

const normalizeCreateBody = (b: CreateClientBody): CreateClientBody => ({
    ...b,
    first_name: safeTrim(b.first_name),
    last_name: safeTrim(b.last_name),
    email: b.email ? safeTrim(b.email) : b.email ?? null,
    phone_country_code: b.phone_country_code ? safeTrim(b.phone_country_code) : b.phone_country_code ?? null,
    phone_number: b.phone_number ? safeTrim(b.phone_number) : b.phone_number ?? null,
    additional_email: b.additional_email ? safeTrim(b.additional_email) : b.additional_email ?? null,
    additional_phone_country_code: b.additional_phone_country_code ? safeTrim(b.additional_phone_country_code) : b.additional_phone_country_code ?? null,
    additional_phone_number: b.additional_phone_number ? safeTrim(b.additional_phone_number) : b.additional_phone_number ?? null,
    birthday_day_month: b.birthday_day_month ? safeTrim(b.birthday_day_month) : b.birthday_day_month ?? null,
    preferred_language: b.preferred_language ? safeTrim(b.preferred_language) : b.preferred_language ?? null,
    occupation: b.occupation ? safeTrim(b.occupation) : b.occupation ?? null,
    country: b.country ? safeTrim(b.country) : b.country ?? null,
    avatar_url: b.avatar_url ? safeTrim(b.avatar_url) : b.avatar_url ?? null,
    client_source: b.client_source ? safeTrim(b.client_source) : b.client_source ?? null,
    gender: b.gender ? safeTrim(b.gender) : b.gender ?? null,
    pronouns: b.pronouns ? safeTrim(b.pronouns) : b.pronouns ?? null,
});

export const clientsService = {
    async list(query: ClientsListQuery, salonId: string) {
        return clientsRepository.list(query, salonId);
    },

    async create(body: CreateClientBody, salonId: string): Promise<ClientWithRelations> {
        const created = await clientsRepository.create(normalizeCreateBody(body), salonId);

        if (body.addresses?.length) await clientsRepository.replaceUpsertAddresses(created.id, body.addresses);
        if (body.emergency_contacts?.length) await clientsRepository.replaceUpsertEmergencyContacts(created.id, body.emergency_contacts);

        const withRel = await clientsRepository.getByIdWithRelations(created.id, salonId);
        return withRel as ClientWithRelations;
    },

    async getById(clientId: string, salonId: string, include?: string): Promise<ClientWithRelations> {
        const includeSet = new Set(
            String(include || "").split(",").map((s) => s.trim()).filter(Boolean)
        );

        const client = await clientsRepository.findById(clientId, salonId);
        if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

        const result: ClientWithRelations = client as any;
        if (includeSet.has("addresses") || includeSet.has("emergency_contacts")) {
            const rel = await clientsRepository.getRelations(clientId);
            if (includeSet.has("addresses")) result.addresses = rel.addresses;
            if (includeSet.has("emergency_contacts")) result.emergency_contacts = rel.emergency_contacts;
        }
        return result;
    },

    async update(clientId: string, patch: UpdateClientBody, salonId: string): Promise<ClientWithRelations> {
        const exists = await clientsRepository.findById(clientId, salonId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        const updated = await clientsRepository.update(clientId, patch, salonId);

        if (patch.addresses) await clientsRepository.replaceUpsertAddresses(clientId, patch.addresses);
        if (patch.emergency_contacts) await clientsRepository.replaceUpsertEmergencyContacts(clientId, patch.emergency_contacts);

        const withRel = await clientsRepository.getByIdWithRelations(updated.id, salonId);
        return withRel as ClientWithRelations;
    },

    async remove(clientId: string, salonId: string, hard?: boolean): Promise<void> {
        const exists = await clientsRepository.findById(clientId, salonId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        if (hard) await clientsRepository.hardDelete(clientId, salonId);
        else await clientsRepository.softDelete(clientId, salonId);
    },

    async blockClients(ids: string[], reason: string, salonId: string): Promise<void> {
        if (!ids?.length) return;
        await clientsRepository.blockClients(ids, reason, salonId);
    },

    async unblockClients(ids: string[], salonId: string): Promise<void> {
        if (!ids?.length) return;
        await clientsRepository.unblockClients(ids, salonId);
    },

    // ---------------- IMPORT ----------------
    async importClients(params: {
        rows: Array<any>;
        mode: ClientsImportMode;
        dry_run: boolean;
        salonId: string;
    }): Promise<ClientsImportResult> {
        const result: ClientsImportResult = {
            total_rows: params.rows.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
        };

        // Normalize CSV row: build a lowercase-keyed copy (spaces → underscore) so column
        // matching works regardless of how the user named their columns (e.g. "Mobile Number"
        // or "mobile" or "Phone" all resolve to the same lookup key).
        const normalizeRow = (r: any): Record<string, any> => {
            const out: Record<string, any> = { ...r };
            for (const [k, v] of Object.entries(r)) {
                const lk = k.toLowerCase().replace(/\s+/g, '_');
                out[lk] = v;
            }
            return out;
        };

        const toBody = (raw: any): CreateClientBody => {
            const r = normalizeRow(raw);
            const phoneVal = r.mobile ?? r.phone_number ?? r.mobile_number ?? r.phone ?? null;
            return {
                first_name: String(r.firstname ?? r.first_name ?? "").trim(),
                last_name: String(r.lastname ?? r.last_name ?? "").trim(),
                email: r.email ? String(r.email).trim() : null,
                phone_country_code: r.phone_country_code ?? null,
                phone_number: phoneVal != null && String(phoneVal).trim()
                    ? String(phoneVal).trim()
                    : null,
                additional_email: null,
                additional_phone_country_code: null,
                additional_phone_number: null,
                birthday_day_month: r.birthday ? String(r.birthday).trim() : null,
                birthday_year: null,
                client_source: null,
                preferred_language: null,
                occupation: null,
                country: null,
                gender: r.gender ? String(r.gender).trim() : null,
                pronouns: null,
                avatar_url: null,
            };
        };

        // Track phone numbers and emails seen in this batch to catch within-file duplicates
        const seenPhones = new Set<string>();
        const seenEmails = new Set<string>();

        for (let i = 0; i < params.rows.length; i++) {
            const rowNum = i + 1;
            try {
                const body = normalizeCreateBody(toBody(params.rows[i]));

                if (!body.first_name) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "first_name is required" });
                    continue;
                }

                const phoneKey = body.phone_number?.trim() || null;
                const emailKey = body.email?.toLowerCase().trim() || null;

                // Skip duplicates within this upload batch
                if (phoneKey && seenPhones.has(phoneKey)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "DUPLICATE_IN_BATCH", message: `Phone number ${phoneKey} appears more than once in this file — row skipped` });
                    continue;
                }
                if (emailKey && seenEmails.has(emailKey)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "DUPLICATE_IN_BATCH", message: `Email ${emailKey} appears more than once in this file — row skipped` });
                    continue;
                }

                if (phoneKey) seenPhones.add(phoneKey);
                if (emailKey) seenEmails.add(emailKey);

                // Check against existing records in the database
                const existing = await clientsRepository.findExistingByEmailOrPhone(
                    { email: body.email ?? null, phone_country_code: body.phone_country_code ?? null, phone_number: phoneKey },
                    params.salonId
                );

                if (existing) {
                    // Duplicate found in DB — always skip regardless of mode
                    result.skipped += 1;
                    continue;
                }

                if (!params.dry_run) await clientsRepository.create(body, params.salonId);
                result.imported += 1;
            } catch (e: any) {
                result.errors.push({ row: rowNum, code: "IMPORT_ERROR", message: e?.message || "Unknown error" });
            }
        }

        return result;
    },

    async findDuplicatesByPhone(phone_number: string, salonId: string): Promise<Client[]> {
        const cleaned = String(phone_number || "").trim();
        if (!cleaned) throw new AppError(400, "phone_number is required", "VALIDATION_ERROR");
        return clientsRepository.findDuplicatesByPhone(cleaned, salonId);
    },

    async mergeClients(body: ClientsMergeBody, salonId: string) {
        const allIds = [body.target_client_id, ...body.source_client_ids];
        const uniqueIds = Array.from(new Set(allIds));
        if (uniqueIds.length < 2)
            throw new AppError(400, "At least 2 unique client IDs are required to merge", "VALIDATION_ERROR");

        const clients: Client[] = [];
        for (const id of uniqueIds) {
            const c = await clientsRepository.findById(id, salonId);
            if (!c) throw new AppError(404, `Client ${id} not found`, "NOT_FOUND");
            clients.push(c);
        }

        clients.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        const targetId = clients[0].id;
        const sourceIds = clients.slice(1).map((c) => c.id);
        const strategy: MergeStrategy = body.strategy ?? "fill_missing_from_sources";

        return clientsRepository.mergeClients({ targetId, sourceIds, strategy, salonId });
    },

    async mergeAllDuplicates(salonId: string): Promise<{
        total_groups: number;
        total_merged: number;
        total_archived: number;
        results: Array<any>;
        errors: Array<any>;
    }> {
        const groups = await clientsRepository.findAllDuplicateGroups(salonId);
        const phoneNumbers = Object.keys(groups);

        const result = {
            total_groups: phoneNumbers.length,
            total_merged: 0,
            total_archived: 0,
            results: [] as any[],
            errors: [] as any[],
        };

        if (phoneNumbers.length === 0) return result;

        for (const phone of phoneNumbers) {
            const clients = groups[phone];
            try {
                const targetId = clients[0].id;
                const sourceIds = clients.slice(1).map((c) => c.id);
                const merged = await clientsRepository.mergeClients({
                    targetId,
                    sourceIds,
                    strategy: "fill_missing_from_sources",
                    salonId,
                });
                result.total_merged += 1;
                result.total_archived += sourceIds.length;
                result.results.push({
                    phone_number: phone,
                    target_client_id: merged.target_client_id,
                    archived_client_ids: merged.archived_source_client_ids,
                    updated_fields: merged.updated_fields,
                });
            } catch (e: any) {
                result.errors.push({ phone_number: phone, message: e?.message || "Unknown error" });
            }
        }

        return result;
    },

    async search(q: string, salonId: string, limit?: number): Promise<Client[]> {
        const term = String(q || "").trim();
        if (term.length < 2) throw new AppError(400, "q must be at least 2 characters", "VALIDATION_ERROR");
        return clientsRepository.search(term, limit ?? 20, salonId);
    },
};
