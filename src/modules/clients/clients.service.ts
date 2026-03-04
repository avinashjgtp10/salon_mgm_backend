// src/modules/clients/clients.service.ts
import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "./clients.repository";
import {
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
    async list(query: ClientsListQuery) {
        return clientsRepository.list(query);
    },

    async create(body: CreateClientBody): Promise<ClientWithRelations> {
        const created = await clientsRepository.create(normalizeCreateBody(body));

        if (body.addresses?.length) await clientsRepository.replaceUpsertAddresses(created.id, body.addresses);
        if (body.emergency_contacts?.length) await clientsRepository.replaceUpsertEmergencyContacts(created.id, body.emergency_contacts);

        const withRel = await clientsRepository.getByIdWithRelations(created.id);
        return withRel as ClientWithRelations;
    },

    async getById(clientId: string, include?: string): Promise<ClientWithRelations> {
        const includeSet = new Set(
            String(include || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
        );

        const client = await clientsRepository.findById(clientId);
        if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

        const result: ClientWithRelations = client as any;
        if (includeSet.has("addresses") || includeSet.has("emergency_contacts")) {
            const rel = await clientsRepository.getRelations(clientId);
            if (includeSet.has("addresses")) result.addresses = rel.addresses;
            if (includeSet.has("emergency_contacts")) result.emergency_contacts = rel.emergency_contacts;
        }
        return result;
    },

    async update(clientId: string, patch: UpdateClientBody): Promise<ClientWithRelations> {
        const exists = await clientsRepository.findById(clientId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        const updated = await clientsRepository.update(clientId, patch);

        // relations: simple replace strategy when arrays provided
        if (patch.addresses) await clientsRepository.replaceUpsertAddresses(clientId, patch.addresses);
        if (patch.emergency_contacts) await clientsRepository.replaceUpsertEmergencyContacts(clientId, patch.emergency_contacts);

        const withRel = await clientsRepository.getByIdWithRelations(updated.id);
        return withRel as ClientWithRelations;
    },

    async remove(clientId: string, hard?: boolean): Promise<void> {
        const exists = await clientsRepository.findById(clientId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        if (hard) await clientsRepository.hardDelete(clientId);
        else await clientsRepository.softDelete(clientId);
    },

    // ---------------- IMPORT ----------------
    async importClients(params: {
        rows: Array<any>;
        mode: ClientsImportMode;
        dry_run: boolean;
    }): Promise<ClientsImportResult> {
        const result: ClientsImportResult = {
            total_rows: params.rows.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
        };

        // basic mapping: expects columns like:
        // first_name,last_name,email,phone_country_code,phone_number,client_source,country,birthday_day_month,birthday_year
        const toBody = (r: any): CreateClientBody => ({
            first_name: String(r.first_name ?? r["First Name"] ?? r["first name"] ?? "").trim(),
            last_name: String(r.last_name ?? r["Last Name"] ?? r["last name"] ?? "").trim(),
            email: r.email ?? r["Email"] ?? null,
            phone_country_code: r.phone_country_code ?? r["Phone Country Code"] ?? r["country_code"] ?? null,
            phone_number: r.phone_number ?? r["Phone"] ?? r["phone"] ?? null,
            additional_email: r.additional_email ?? r["Additional Email"] ?? null,
            additional_phone_country_code: r.additional_phone_country_code ?? r["Additional Phone Country Code"] ?? null,
            additional_phone_number: r.additional_phone_number ?? r["Additional Phone"] ?? null,
            birthday_day_month: r.birthday_day_month ?? r["Birthday Day Month"] ?? r["birthday_mmdd"] ?? null,
            birthday_year: r.birthday_year ? Number(r.birthday_year) : r["Birthday Year"] ? Number(r["Birthday Year"]) : null,
            client_source: r.client_source ?? r["Client Source"] ?? null,
            preferred_language: r.preferred_language ?? r["Preferred Language"] ?? null,
            occupation: r.occupation ?? r["Occupation"] ?? null,
            country: r.country ?? r["Country"] ?? null,
            gender: r.gender ?? r["Gender"] ?? null,
            pronouns: r.pronouns ?? r["Pronouns"] ?? null,
            avatar_url: r.avatar_url ?? r["Avatar URL"] ?? null,
        });

        for (let i = 0; i < params.rows.length; i++) {
            const rowNum = i + 1;
            try {
                const body = normalizeCreateBody(toBody(params.rows[i]));

                if (!body.first_name || !body.last_name) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "first_name and last_name are required" });
                    continue;
                }

                const existing = await clientsRepository.findExistingByEmailOrPhone({
                    email: body.email ?? null,
                    phone_country_code: body.phone_country_code ?? null,
                    phone_number: body.phone_number ?? null,
                });

                if (params.mode === "create_only") {
                    if (existing) {
                        result.skipped += 1;
                        continue;
                    }
                    if (!params.dry_run) await clientsRepository.create(body);
                    result.imported += 1;
                    continue;
                }

                // upsert
                if (!existing) {
                    if (!params.dry_run) await clientsRepository.create(body);
                    result.imported += 1;
                } else {
                    if (!params.dry_run) {
                        await clientsRepository.update(existing.id, {
                            ...body,
                            // keep is_active default true on updates? you can decide:
                            is_active: true,
                        } as any);
                    }
                    result.updated += 1;
                }
            } catch (e: any) {
                result.errors.push({ row: rowNum, code: "IMPORT_ERROR", message: e?.message || "Unknown error" });
            }
        }

        return result;
    },

    // ---------------- MERGE ----------------
    async mergeClients(body: ClientsMergeBody) {
        const target = await clientsRepository.findById(body.target_client_id);
        if (!target) throw new AppError(404, "Target client not found", "NOT_FOUND");

        const strategy: MergeStrategy = body.strategy ?? "fill_missing_from_sources";

        return clientsRepository.mergeClients({
            targetId: body.target_client_id,
            sourceIds: body.source_client_ids,
            strategy,
        });
    },
};
