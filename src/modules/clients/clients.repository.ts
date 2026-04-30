// src/modules/clients/clients.repository.ts
import pool from "../../config/database";
import {
    Client,
    ClientAddress,
    ClientEmergencyContact,
    ClientWithRelations,
    CreateClientBody,
    UpdateClientBody,
    ClientsListQuery,
    Paginated,
    MergeStrategy,
} from "./clients.types";

const buildFullName = (first: string, last: string) => `${String(first || "").trim()} ${String(last || "").trim()}`.trim();

export const clientsRepository = {
    // ---------------- BASIC ----------------
    async findById(id: string): Promise<Client | null> {
        const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async getRelations(clientId: string): Promise<{ addresses: ClientAddress[]; emergency_contacts: ClientEmergencyContact[] }> {
        const [addr, emg] = await Promise.all([
            pool.query(`SELECT * FROM client_addresses WHERE client_id = $1 ORDER BY created_at ASC`, [clientId]),
            pool.query(`SELECT * FROM client_emergency_contacts WHERE client_id = $1 ORDER BY created_at ASC`, [clientId]),
        ]);
        return { addresses: addr.rows, emergency_contacts: emg.rows };
    },

    async getByIdWithRelations(id: string): Promise<ClientWithRelations | null> {
        const client = await this.findById(id);
        if (!client) return null;
        const rel = await this.getRelations(id);
        return { ...(client as any), ...rel };
    },

    // ---------------- LIST ----------------
    async list(q: ClientsListQuery): Promise<Paginated<Client>> {
        const offset = q.offset ?? 0;
        const limit = q.limit ?? 30;

        const sortBy = q.sort_by ?? "created_at";
        const sortOrder = q.sort_order ?? "desc";

        const allowedSort = new Set(["created_at", "full_name", "total_sales"]);
        const allowedOrder = new Set(["asc", "desc"]);
        const sb = allowedSort.has(sortBy) ? sortBy : "created_at";
        const so = allowedOrder.has(sortOrder) ? sortOrder : "desc";

        const where: string[] = [];
        const params: any[] = [];

        // inactive filter
        const includeInactive = q.inactive === true;
        if (!includeInactive) {
            params.push(true);
            where.push(`is_active = $${params.length}`);
        }

        // source filter
        if (q.source) {
            params.push(q.source);
            where.push(`client_source = $${params.length}`);
        }

        // created date filters
        if (q.created_from) {
            params.push(q.created_from);
            where.push(`created_at::date >= $${params.length}::date`);
        }
        if (q.created_to) {
            params.push(q.created_to);
            where.push(`created_at::date <= $${params.length}::date`);
        }

        // client group filter
        if (q.client_group && q.client_group !== "all") {
            if (q.client_group === "fresha_accounts") {
                params.push("fresha");
                where.push(`client_source = $${params.length}`);
            } else if (q.client_group === "manually_added") {
                params.push("manual");
                where.push(`client_source = $${params.length}`);
            }
        }

        // gender filter
        if (q.gender && q.gender !== "all") {
            params.push(q.gender);
            where.push(`gender = $${params.length}`);
        }

        // search
        if (q.search && q.search.trim()) {
            const s = `%${q.search.trim().toLowerCase()}%`;
            params.push(s);
            const p = `$${params.length}`;
            where.push(`(
        LOWER(full_name) LIKE ${p}
        OR LOWER(COALESCE(email,'')) LIKE ${p}
        OR LOWER(COALESCE(phone_number,'')) LIKE ${p}
        OR LOWER(COALESCE(additional_email,'')) LIKE ${p}
        OR LOWER(COALESCE(additional_phone_number,'')) LIKE ${p}
      )`);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const countSql = `SELECT COUNT(*)::int AS total FROM clients ${whereSql}`;
        const dataSql = `
      SELECT * FROM clients
      ${whereSql}
      ORDER BY ${sb} ${so}
      OFFSET $${params.length + 1}
      LIMIT  $${params.length + 2}
    `;

        const paramsForData = [...params, offset, limit];

        const [countRes, dataRes] = await Promise.all([
            pool.query(countSql, params),
            pool.query(dataSql, paramsForData),
        ]);

        const total = countRes.rows[0]?.total ?? 0;
        const has_more = offset + limit < total;

        return {
            items: dataRes.rows,
            total,
            offset,
            limit,
            has_more,
        };
    },

    // ---------------- CREATE/UPDATE ----------------
    async create(body: CreateClientBody): Promise<Client> {
        const fullName = buildFullName(body.first_name, body.last_name);

        const { rows } = await pool.query(
            `INSERT INTO clients (
        first_name,last_name,full_name,
        email,phone_country_code,phone_number,
        additional_email,additional_phone_country_code,additional_phone_number,
        birthday_day_month,birthday_year,
        gender,pronouns,
        client_source,referred_by_client_id,
        preferred_language,occupation,country,avatar_url,
        email_notifications,sms_notifications,whatsapp_notifications,
        email_marketing,sms_marketing,whatsapp_marketing
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,
        $7,$8,$9,
        $10,$11,
        $12,$13,
        $14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,
        $23,$24,$25
      ) RETURNING *`,
            [
                body.first_name.trim(),
                body.last_name.trim(),
                fullName,
                body.email ?? null,
                body.phone_country_code ?? null,
                body.phone_number ?? null,
                body.additional_email ?? null,
                body.additional_phone_country_code ?? null,
                body.additional_phone_number ?? null,
                body.birthday_day_month || null,
                body.birthday_year || null,
                body.gender ?? null,
                body.pronouns ?? null,
                body.client_source ?? null,
                body.referred_by_client_id ?? null,
                body.preferred_language ?? null,
                body.occupation ?? null,
                body.country ?? null,
                body.avatar_url ?? null,
                body.email_notifications ?? true,
                body.sms_notifications ?? true,
                body.whatsapp_notifications ?? true,
                body.email_marketing ?? false,
                body.sms_marketing ?? false,
                body.whatsapp_marketing ?? false,
            ]
        );

        return rows[0];
    },

    async update(clientId: string, patch: UpdateClientBody): Promise<Client> {
        // handle full_name if first/last changes
        const keys = Object.keys(patch) as (keyof UpdateClientBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [clientId]);
            return rows[0];
        }

        // compute full_name if needed
        let full_name: string | undefined;
        if (patch.first_name !== undefined || patch.last_name !== undefined) {
            const existing = await this.findById(clientId);
            const f = patch.first_name ?? existing?.first_name ?? "";
            const l = patch.last_name ?? existing?.last_name ?? "";
            full_name = buildFullName(f, l);
        }

        const setParts: string[] = [];
        const values: any[] = [];
        let idx = 1;

        const add = (col: string, val: any) => {
            setParts.push(`${col} = $${idx++}`);
            values.push(val);
        };

        for (const k of keys) {
            if (k === "addresses" || k === "emergency_contacts") continue; // relations handled elsewhere
            if (k === "first_name") add("first_name", patch.first_name ?? null);
            else if (k === "last_name") add("last_name", patch.last_name ?? null);
            else if (k === "email") add("email", patch.email ?? null);
            else if (k === "phone_country_code") add("phone_country_code", patch.phone_country_code ?? null);
            else if (k === "phone_number") add("phone_number", patch.phone_number ?? null);
            else if (k === "additional_email") add("additional_email", patch.additional_email ?? null);
            else if (k === "additional_phone_country_code") add("additional_phone_country_code", patch.additional_phone_country_code ?? null);
            else if (k === "additional_phone_number") add("additional_phone_number", patch.additional_phone_number ?? null);
            else if (k === "birthday_day_month") add("birthday_day_month", patch.birthday_day_month || null);
            else if (k === "birthday_year") add("birthday_year", patch.birthday_year || null);
            else if (k === "gender") add("gender", patch.gender ?? null);
            else if (k === "pronouns") add("pronouns", patch.pronouns ?? null);
            else if (k === "client_source") add("client_source", patch.client_source ?? null);
            else if (k === "referred_by_client_id") add("referred_by_client_id", patch.referred_by_client_id ?? null);
            else if (k === "preferred_language") add("preferred_language", patch.preferred_language ?? null);
            else if (k === "occupation") add("occupation", patch.occupation ?? null);
            else if (k === "country") add("country", patch.country ?? null);
            else if (k === "avatar_url") add("avatar_url", patch.avatar_url ?? null);
            else if (k === "is_active") add("is_active", patch.is_active ?? true);
            else if (k === "block_reason") add("block_reason", patch.block_reason ?? null);
            else if (k === "email_notifications") add("email_notifications", patch.email_notifications ?? true);
            else if (k === "sms_notifications") add("sms_notifications", patch.sms_notifications ?? true);
            else if (k === "whatsapp_notifications") add("whatsapp_notifications", patch.whatsapp_notifications ?? true);
            else if (k === "email_marketing") add("email_marketing", patch.email_marketing ?? false);
            else if (k === "sms_marketing") add("sms_marketing", patch.sms_marketing ?? false);
            else if (k === "whatsapp_marketing") add("whatsapp_marketing", patch.whatsapp_marketing ?? false);
        }

        if (full_name !== undefined) add("full_name", full_name);

        setParts.push(`updated_at = NOW()`);

        values.push(clientId);

        const { rows } = await pool.query(
            `UPDATE clients SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
            values
        );

        return rows[0];
    },

    // ---------------- RELATIONS UPSERT ----------------
    async replaceUpsertAddresses(clientId: string, items: Array<any>): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // delete ones not included if ids exist (simple strategy: replace all)
            await client.query(`DELETE FROM client_addresses WHERE client_id = $1`, [clientId]);

            for (const a of items) {
                await client.query(
                    `INSERT INTO client_addresses (
            client_id, type, address_name, address_line1, address_line2, apt_suite, district, city, region, postcode, country
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [
                        clientId,
                        a.type,
                        a.address_name ?? null,
                        a.address_line1 ?? null,
                        a.address_line2 ?? null,
                        a.apt_suite ?? null,
                        a.district ?? null,
                        a.city ?? null,
                        a.region ?? null,
                        a.postcode ?? null,
                        a.country ?? null,
                    ]
                );
            }

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async replaceUpsertEmergencyContacts(clientId: string, items: Array<any>): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            await client.query(`DELETE FROM client_emergency_contacts WHERE client_id = $1`, [clientId]);

            for (const e of items) {
                await client.query(
                    `INSERT INTO client_emergency_contacts (
            client_id, type, full_name, relationship, email, phone_country_code, phone_number
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [
                        clientId,
                        e.type,
                        e.full_name,
                        e.relationship ?? null,
                        e.email ?? null,
                        e.phone_country_code ?? null,
                        e.phone_number ?? null,
                    ]
                );
            }

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    // ---------------- SOFT/HARD DELETE ----------------
    async softDelete(clientId: string): Promise<void> {
        await pool.query(`UPDATE clients SET is_active = false, updated_at = NOW() WHERE id = $1`, [clientId]);
    },

    async hardDelete(clientId: string): Promise<void> {
        await pool.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
    },

    async blockClients(ids: string[], reason: string) {
        await pool.query(
            `UPDATE clients SET is_active = false, block_reason = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
            [reason, ids]
        );
    },

    // ---------------- IMPORT HELPERS ----------------
    async findExistingByEmailOrPhone(params: { email?: string | null; phone_country_code?: string | null; phone_number?: string | null }) {
        const email = params.email ? String(params.email).trim() : null;
        const pcc = params.phone_country_code ? String(params.phone_country_code).trim() : null;
        const pn = params.phone_number ? String(params.phone_number).trim() : null;

        if (email) {
            const r = await pool.query(`SELECT * FROM clients WHERE email = $1 LIMIT 1`, [email]);
            if (r.rows[0]) return r.rows[0] as Client;
        }

        if (pcc && pn) {
            const r = await pool.query(`SELECT * FROM clients WHERE phone_country_code = $1 AND phone_number = $2 LIMIT 1`, [pcc, pn]);
            if (r.rows[0]) return r.rows[0] as Client;
        }

        return null;
    },

    // ── Find duplicates by phone ──────────────────────────────────────────────────
    async findDuplicatesByPhone(phone_number: string): Promise<Client[]> {
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE TRIM(phone_number) = $1
             AND is_active = true
             ORDER BY created_at ASC`,
            [phone_number.trim()]
        );
        return rows as Client[];
    },

    // ── Merge ─────────────────────────────────────────────────────────────────────
    async mergeClients(params: {
        targetId:  string;
        sourceIds: string[];
        strategy:  MergeStrategy;
    }): Promise<{
        target_client_id:           string;
        merged_source_client_ids:   string[];
        archived_source_client_ids: string[];
        updated_fields:             string[];
    }> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Lock target row
            const targetRes = await client.query(
                `SELECT * FROM clients WHERE id = $1 FOR UPDATE`,
                [params.targetId]
            );
            const target = targetRes.rows[0] as any;
            if (!target) throw new Error("Target client not found");

            // Lock all source rows
            const sourcesRes = await client.query(
                `SELECT * FROM clients WHERE id = ANY($1::uuid[]) FOR UPDATE`,
                [params.sourceIds]
            );
            const sources = sourcesRes.rows as any[];
            if (sources.length !== params.sourceIds.length)
                throw new Error("One or more source clients not found");

            // ── Apply merge strategy ──────────────────────────────────────────────
            const updated_fields: string[] = [];

            const isEmpty = (v: any) =>
                v === null || v === undefined || (typeof v === "string" && !v.trim());

            const apply = (field: string, value: any) => {
                target[field] = value;
                updated_fields.push(field);
            };

            if (params.strategy === "prefer_source") {
                // Last source value wins when it has a value
                for (const s of sources) {
                    for (const f of Object.keys(s)) {
                        if (["id", "created_at", "updated_at"].includes(f)) continue;
                        if (!isEmpty(s[f])) apply(f, s[f]);
                    }
                }
            } else if (params.strategy === "fill_missing_from_sources") {
                // Only fill fields that are empty on the target
                for (const s of sources) {
                    for (const f of Object.keys(s)) {
                        if (["id", "created_at", "updated_at"].includes(f)) continue;
                        if (isEmpty(target[f]) && !isEmpty(s[f])) apply(f, s[f]);
                    }
                }
            }
            // prefer_target → no field changes, target data wins as-is

            // Always recompute full_name for safety
            const full_name =
                `${String(target.first_name || "").trim()} ${String(target.last_name || "").trim()}`.trim();
            if (target.full_name !== full_name) apply("full_name", full_name);

            // ── Update target fields ──────────────────────────────────────────────
            const fieldsToUpdate = Array.from(new Set(updated_fields));
            if (fieldsToUpdate.length) {
                const setParts: string[] = [];
                const values:   any[]    = [];
                let i = 1;
                for (const f of fieldsToUpdate) {
                    setParts.push(`${f} = $${i++}`);
                    values.push(target[f]);
                }
                setParts.push(`updated_at = NOW()`);
                values.push(params.targetId);
                await client.query(
                    `UPDATE clients SET ${setParts.join(", ")} WHERE id = $${values.length}`,
                    values
                );
            } else {
                // No field changes but still touch updated_at
                await client.query(
                    `UPDATE clients SET updated_at = NOW() WHERE id = $1`,
                    [params.targetId]
                );
            }

            // ── Move all relations to target ──────────────────────────────────────
            await client.query(
                `UPDATE client_addresses
                 SET client_id = $1
                 WHERE client_id = ANY($2::uuid[])`,
                [params.targetId, params.sourceIds]
            );

            // 1. Delete source contacts that conflict with target's existing types
            await client.query(
                `DELETE FROM client_emergency_contacts
                 WHERE client_id = ANY($1::uuid[])
                 AND type IN (SELECT type FROM client_emergency_contacts WHERE client_id = $2)`,
                [params.sourceIds, params.targetId]
            );

            // 2. Deduplicate BETWEEN sources (if multiple sources have same type, keep oldest)
            await client.query(
                `DELETE FROM client_emergency_contacts
                 WHERE id IN (
                     SELECT id FROM (
                         SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at ASC) as rn
                         FROM client_emergency_contacts
                         WHERE client_id = ANY($1::uuid[])
                     ) t WHERE rn > 1
                 )`,
                [params.sourceIds]
            );

            // 3. Move remaining unique contacts
            await client.query(
                `UPDATE client_emergency_contacts
                 SET client_id = $1
                 WHERE client_id = ANY($2::uuid[])`,
                [params.targetId, params.sourceIds]
            );

            // ── Archive source clients ────────────────────────────────────────────
            await client.query(
                `UPDATE clients
                 SET is_active = false, updated_at = NOW()
                 WHERE id = ANY($1::uuid[])`,
                [params.sourceIds]
            );

            await client.query("COMMIT");

            return {
                target_client_id:           params.targetId,
                merged_source_client_ids:   params.sourceIds,
                archived_source_client_ids: params.sourceIds,
                updated_fields:             fieldsToUpdate,
            };
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    // Find all groups of clients sharing the same phone number
    async findAllDuplicateGroups(): Promise<Record<string, Client[]>> {
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE phone_number IS NOT NULL
             AND TRIM(phone_number) != ''
             AND is_active = true
             AND phone_number IN (
                 SELECT phone_number
                 FROM clients
                 WHERE phone_number IS NOT NULL
                 AND TRIM(phone_number) != ''
                 AND is_active = true
                 GROUP BY phone_number
                 HAVING COUNT(*) > 1
             )
             ORDER BY phone_number, created_at ASC`
        );

        // Group by phone_number
        const groups: Record<string, Client[]> = {};
        for (const row of rows) {
            const phone = row.phone_number.trim();
            if (!groups[phone]) groups[phone] = [];
            groups[phone].push(row as Client);
        }
        return groups;
    },

    // ---------------- SEARCH ----------------
    /**
     * Search clients by name (full_name) or phone_number.
     * Case-insensitive partial match. Excludes inactive/archived clients.
     * Returns at most `limit` rows (default 20).
     */
    async search(q: string, limit = 20): Promise<Client[]> {
        const term = `%${q.trim().toLowerCase()}%`;

        const { rows } = await pool.query(
            `SELECT
                id,
                first_name,
                last_name,
                full_name,
                email,
                phone_country_code,
                phone_number,
                avatar_url,
                is_active,
                created_at,
                updated_at
             FROM clients
             WHERE is_active = true
               AND (
                   LOWER(full_name)     LIKE $1
                OR LOWER(COALESCE(phone_number, '')) LIKE $1
               )
             ORDER BY full_name ASC
             LIMIT $2`,
            [term, limit]
        );

        return rows as Client[];
    },
};

