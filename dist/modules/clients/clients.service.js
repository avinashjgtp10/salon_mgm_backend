"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientsService = void 0;
// src/modules/clients/clients.service.ts
const error_middleware_1 = require("../../middleware/error.middleware");
const clients_repository_1 = require("./clients.repository");
const safeTrim = (v) => (v === null || v === undefined ? v : String(v).trim());
const normalizeCreateBody = (b) => ({
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
exports.clientsService = {
    async list(query) {
        return clients_repository_1.clientsRepository.list(query);
    },
    async create(body) {
        const created = await clients_repository_1.clientsRepository.create(normalizeCreateBody(body));
        if (body.addresses?.length)
            await clients_repository_1.clientsRepository.replaceUpsertAddresses(created.id, body.addresses);
        if (body.emergency_contacts?.length)
            await clients_repository_1.clientsRepository.replaceUpsertEmergencyContacts(created.id, body.emergency_contacts);
        const withRel = await clients_repository_1.clientsRepository.getByIdWithRelations(created.id);
        return withRel;
    },
    async getById(clientId, include) {
        const includeSet = new Set(String(include || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean));
        const client = await clients_repository_1.clientsRepository.findById(clientId);
        if (!client)
            throw new error_middleware_1.AppError(404, "Client not found", "NOT_FOUND");
        const result = client;
        if (includeSet.has("addresses") || includeSet.has("emergency_contacts")) {
            const rel = await clients_repository_1.clientsRepository.getRelations(clientId);
            if (includeSet.has("addresses"))
                result.addresses = rel.addresses;
            if (includeSet.has("emergency_contacts"))
                result.emergency_contacts = rel.emergency_contacts;
        }
        return result;
    },
    async update(clientId, patch) {
        const exists = await clients_repository_1.clientsRepository.findById(clientId);
        if (!exists)
            throw new error_middleware_1.AppError(404, "Client not found", "NOT_FOUND");
        const updated = await clients_repository_1.clientsRepository.update(clientId, patch);
        // relations: simple replace strategy when arrays provided
        if (patch.addresses)
            await clients_repository_1.clientsRepository.replaceUpsertAddresses(clientId, patch.addresses);
        if (patch.emergency_contacts)
            await clients_repository_1.clientsRepository.replaceUpsertEmergencyContacts(clientId, patch.emergency_contacts);
        const withRel = await clients_repository_1.clientsRepository.getByIdWithRelations(updated.id);
        return withRel;
    },
    async remove(clientId, hard) {
        const exists = await clients_repository_1.clientsRepository.findById(clientId);
        if (!exists)
            throw new error_middleware_1.AppError(404, "Client not found", "NOT_FOUND");
        if (hard)
            await clients_repository_1.clientsRepository.hardDelete(clientId);
        else
            await clients_repository_1.clientsRepository.softDelete(clientId);
    },
    async blockClients(ids, reason) {
        if (!ids?.length)
            return;
        await clients_repository_1.clientsRepository.blockClients(ids, reason);
    },
    // ---------------- IMPORT ----------------
    async importClients(params) {
        const result = {
            total_rows: params.rows.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
        };
        // basic mapping: expects columns like:
        // first_name,last_name,email,phone_country_code,phone_number,client_source,country,birthday_day_month,birthday_year
        const toBody = (r) => ({
            first_name: String(r.firstName ?? "").trim(),
            last_name: String(r.lastName ?? "").trim(),
            email: r.email ? String(r.email).trim() : null,
            phone_country_code: null, // not in FRESHA_COLUMNS — stays null unless you add it
            phone_number: r.mobile ? String(r.mobile).trim() : null,
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
        });
        for (let i = 0; i < params.rows.length; i++) {
            const rowNum = i + 1;
            try {
                const body = normalizeCreateBody(toBody(params.rows[i]));
                if (!body.first_name) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "first_name is required" });
                    continue;
                }
                const existing = await clients_repository_1.clientsRepository.findExistingByEmailOrPhone({
                    email: body.email ?? null,
                    phone_country_code: body.phone_country_code ?? null,
                    phone_number: body.phone_number ?? null,
                });
                if (params.mode === "create_only") {
                    if (existing) {
                        result.skipped += 1;
                        continue;
                    }
                    if (!params.dry_run)
                        await clients_repository_1.clientsRepository.create(body);
                    result.imported += 1;
                    continue;
                }
                // upsert
                if (!existing) {
                    if (!params.dry_run)
                        await clients_repository_1.clientsRepository.create(body);
                    result.imported += 1;
                }
                else {
                    if (!params.dry_run) {
                        await clients_repository_1.clientsRepository.update(existing.id, {
                            ...body,
                            // keep is_active default true on updates? you can decide:
                            is_active: true,
                        });
                    }
                    result.updated += 1;
                }
            }
            catch (e) {
                result.errors.push({ row: rowNum, code: "IMPORT_ERROR", message: e?.message || "Unknown error" });
            }
        }
        return result;
    },
    // ── Find duplicates by phone (called by GET /duplicates) ──────────────────────
    async findDuplicatesByPhone(phone_number) {
        const cleaned = String(phone_number || "").trim();
        if (!cleaned)
            throw new error_middleware_1.AppError(400, "phone_number is required", "VALIDATION_ERROR");
        const duplicates = await clients_repository_1.clientsRepository.findDuplicatesByPhone(cleaned);
        return duplicates;
    },
    // ── Merge clients ─────────────────────────────────────────────────────────────
    async mergeClients(body) {
        // Collect all IDs (target + sources) and find the oldest automatically
        const allIds = [body.target_client_id, ...body.source_client_ids];
        // Remove duplicates
        const uniqueIds = Array.from(new Set(allIds));
        if (uniqueIds.length < 2)
            throw new error_middleware_1.AppError(400, "At least 2 unique client IDs are required to merge", "VALIDATION_ERROR");
        // Fetch all clients and validate they exist
        const clients = [];
        for (const id of uniqueIds) {
            const c = await clients_repository_1.clientsRepository.findById(id);
            if (!c)
                throw new error_middleware_1.AppError(404, `Client ${id} not found`, "NOT_FOUND");
            clients.push(c);
        }
        // Sort by created_at ASC — oldest is always the target
        clients.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const targetId = clients[0].id;
        const sourceIds = clients.slice(1).map((c) => c.id);
        const strategy = body.strategy ?? "fill_missing_from_sources";
        return clients_repository_1.clientsRepository.mergeClients({ targetId, sourceIds, strategy });
    },
    async mergeAllDuplicates() {
        // Get all duplicate groups
        const groups = await clients_repository_1.clientsRepository.findAllDuplicateGroups();
        const phoneNumbers = Object.keys(groups);
        const result = {
            total_groups: phoneNumbers.length,
            total_merged: 0,
            total_archived: 0,
            results: [],
            errors: [],
        };
        if (phoneNumbers.length === 0)
            return result;
        // Process each duplicate group one by one
        for (const phone of phoneNumbers) {
            const clients = groups[phone];
            try {
                // Oldest client (index 0 since ordered by created_at ASC) = target
                const targetId = clients[0].id;
                const sourceIds = clients.slice(1).map((c) => c.id);
                const merged = await clients_repository_1.clientsRepository.mergeClients({
                    targetId,
                    sourceIds,
                    strategy: "fill_missing_from_sources",
                });
                result.total_merged += 1;
                result.total_archived += sourceIds.length;
                result.results.push({
                    phone_number: phone,
                    target_client_id: merged.target_client_id,
                    archived_client_ids: merged.archived_source_client_ids,
                    updated_fields: merged.updated_fields,
                });
            }
            catch (e) {
                result.errors.push({
                    phone_number: phone,
                    message: e?.message || "Unknown error",
                });
            }
        }
        return result;
    },
};
//# sourceMappingURL=clients.service.js.map