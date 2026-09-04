// src/modules/clients/clients.repository.ts
import pool from "../../config/database";
import logger from "../../config/logger";
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
    CampaignFilterParams,
} from "./clients.types";

const buildFullName = (first: string, last?: string | null) =>
    `${String(first || "").trim()} ${String(last || "").trim()}`.trim();

export const clientsRepository = {
    // ---------------- BASIC ----------------
    async findById(id: string, salonId: string): Promise<Client | null> {
        const { rows } = await pool.query(
            `SELECT * FROM clients WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async getRelations(clientId: string): Promise<{ addresses: ClientAddress[]; emergency_contacts: ClientEmergencyContact[] }> {
        const [addr, emg] = await Promise.all([
            pool.query(`SELECT * FROM client_addresses WHERE client_id = $1 ORDER BY created_at ASC`, [clientId]),
            pool.query(`SELECT * FROM client_emergency_contacts WHERE client_id = $1 ORDER BY created_at ASC`, [clientId]),
        ]);
        return { addresses: addr.rows, emergency_contacts: emg.rows };
    },

    async getByIdWithRelations(id: string, salonId: string): Promise<ClientWithRelations | null> {
        const client = await this.findById(id, salonId);
        if (!client) return null;
        const rel = await this.getRelations(id);
        return { ...(client as any), ...rel };
    },

    // ---------------- LIST ----------------
    async list(q: ClientsListQuery, salonId: string): Promise<Paginated<Client>> {
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

        // ── ALWAYS scope to salon ── salon_id is always params[0], relied on
        // below by the total_sales join.
        params.push(salonId);
        where.push(`c.salon_id = $${params.length}`);

        // inactive filter
        const includeInactive = q.inactive === true;
        if (!includeInactive) {
            params.push(true);
            where.push(`c.is_active = $${params.length}`);
        }

        if (q.source) {
            params.push(q.source);
            where.push(`c.client_source = $${params.length}`);
        }
        if (q.created_from) {
            params.push(q.created_from);
            where.push(`c.created_at::date >= $${params.length}::date`);
        }
        if (q.created_to) {
            params.push(q.created_to);
            where.push(`c.created_at::date <= $${params.length}::date`);
        }
        if (q.client_group && q.client_group !== "all") {
            if (q.client_group === "fresha_accounts") {
                params.push("fresha");
                where.push(`c.client_source = $${params.length}`);
            } else if (q.client_group === "manually_added") {
                params.push("manual");
                where.push(`c.client_source = $${params.length}`);
            }
        }
        if (q.gender && q.gender !== "all") {
            params.push(q.gender.toLowerCase());
            where.push(`LOWER(c.gender) = $${params.length}`);
        }
        if (q.search && q.search.trim()) {
            const s = `%${q.search.trim().toLowerCase()}%`;
            params.push(s);
            const p = `$${params.length}`;
            where.push(`(
        LOWER(c.full_name) LIKE ${p}
        OR LOWER(COALESCE(c.email,'')) LIKE ${p}
        OR LOWER(COALESCE(c.phone_number,'')) LIKE ${p}
        OR LOWER(COALESCE(c.additional_email,'')) LIKE ${p}
        OR LOWER(COALESCE(c.additional_phone_number,'')) LIKE ${p}
      )`);
        }

        // Revenue (lifetime paid, wallet-settled money excluded) range. Filters
        // on the same computed figure the `ts` join below produces, so both the
        // count and data queries must include that join (see tsJoin) — a client
        // with no payments coalesces to 0, so a min of 0 still includes them.
        if (q.min_sales !== undefined && !Number.isNaN(q.min_sales)) {
            params.push(q.min_sales);
            where.push(`COALESCE(ts.total_sales, 0) >= $${params.length}`);
        }
        if (q.max_sales !== undefined && !Number.isNaN(q.max_sales)) {
            params.push(q.max_sales);
            where.push(`COALESCE(ts.total_sales, 0) <= $${params.length}`);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        // clients.total_sales is a dead column, never written anywhere — every
        // client shows ₹0 and "highest/lowest sales" sorting has nothing real to
        // sort by. Compute it here instead — same canonical formula as
        // useClientDetails.ts (Calendar/Sale Client Information panel) and
        // ClientHistoryDetail.tsx (History popup/page), read straight from the
        // source tables rather than the `sales` mirror the previous version of
        // this join depended on: a standalone package/membership sale's `sales`
        // row is only ever created by a fire-and-forget background job
        // (transaction-recorder.service.ts) that can fail, so relying on it
        // here under-reported revenue for any client whose mirror row was
        // missing — same root cause as the History-vs-Calendar mismatch this
        // replaced. Four legs, matching useClientDetails.ts's
        // paidRevenue/partialRevenue/packageRevenue/membershipRevenue exactly:
        const tsJoin = `
      LEFT JOIN (
        SELECT client_id, SUM(amount) AS total_sales
        FROM (
          -- Fully-paid appointments: the completed payment's net_amount is
          -- already net of any membership-wallet/package coverage (that
          -- value was already recognized as revenue when the membership/
          -- package was originally sold) — mirrors paidRevenue.
          SELECT a.client_id,
                 (SELECT SUM(p.net_amount) FROM payments p
                  WHERE p.appointment_id = a.id AND p.status = 'completed') AS amount
          FROM appointments a
          WHERE a.salon_id = $1 AND a.client_id IS NOT NULL
            AND a.status = 'paid' AND a.deleted_at IS NULL

          UNION ALL

          -- Partially-paid appointments: amount actually collected, minus
          -- eWallet/membership-wallet portions (neither is new money for the
          -- salon) — mirrors partialRevenue.
          SELECT a.client_id,
                 GREATEST(0,
                   COALESCE((SELECT SUM(p.paid_amount) FROM payments p
                             WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0)
                   - COALESCE((SELECT SUM(p.ewallet_used) FROM payments p
                             WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0)
                   - COALESCE((SELECT SUM(p.membership_wallet_used) FROM payments p
                             WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0)
                 ) AS amount
          FROM appointments a
          WHERE a.salon_id = $1 AND a.client_id IS NOT NULL
            AND a.status = 'partial' AND a.deleted_at IS NULL

          UNION ALL

          -- Standalone package purchases (no linked appointment — one sold as
          -- a line item on an appointment is already counted above via that
          -- appointment's own payment) — mirrors packageRevenue.
          SELECT cp.client_id, cp.paid_amount AS amount
          FROM client_packages cp
          WHERE cp.salon_id = $1 AND cp.appointment_id IS NULL

          UNION ALL

          -- Standalone membership purchases — mirrors membershipRevenue.
          SELECT cm.client_id, cm.price_paid AS amount
          FROM client_memberships cm
          WHERE cm.salon_id = $1 AND cm.appointment_id IS NULL
        ) combined
        WHERE client_id IS NOT NULL
        GROUP BY client_id
      ) ts ON ts.client_id = c.id`;

        const countSql = `SELECT COUNT(*)::int AS total FROM clients c ${tsJoin} ${whereSql}`;

        // Aliased separately from clients.total_sales (not overwritten in the
        // same SELECT) to avoid an ambiguous-column error from ORDER BY when
        // sorting by it.
        const orderCol = sb === "total_sales" ? "computed_total_sales" : `c.${sb}`;
        const dataSql = `
      SELECT c.*, COALESCE(ts.total_sales, 0) AS computed_total_sales
      FROM clients c
      ${tsJoin}
      ${whereSql}
      ORDER BY ${orderCol} ${so}
      OFFSET $${params.length + 1}
      LIMIT  $${params.length + 2}
    `;

        const [countRes, dataRes] = await Promise.all([
            pool.query(countSql, params),
            pool.query(dataSql, [...params, offset, limit]),
        ]);

        const total = countRes.rows[0]?.total ?? 0;
        const items = dataRes.rows.map((r: any) => {
            const { computed_total_sales, ...rest } = r;
            return { ...rest, total_sales: computed_total_sales };
        });
        return {
            items,
            total,
            offset,
            limit,
            has_more: offset + limit < total,
        };
    },

    // ---------------- CREATE ----------------
    // `referral` is computed by the service layer (code generation + uniqueness
    // check, referred_by_code → referred_by_client_id resolution) — kept out of
    // CreateClientBody so a caller can never set their own referral_code directly.
    async create(
        body: CreateClientBody,
        salonId: string,
        referral: { code: string; rewardStatus: "pending" | null },
    ): Promise<Client> {
        const fullName = buildFullName(body.first_name, body.last_name);

        const { rows } = await pool.query(
            `INSERT INTO clients (
        salon_id,
        first_name,last_name,full_name,
        email,phone_country_code,phone_number,
        additional_email,additional_phone_country_code,additional_phone_number,
        birthday_day_month,birthday_year,anniversary,
        gender,pronouns,address,
        client_source,referred_by_client_id,
        preferred_language,occupation,country,avatar_url,
        email_notifications,sms_notifications,whatsapp_notifications,
        email_marketing,sms_marketing,whatsapp_marketing,
        referral_code,referral_reward_status,
        state,pincode,gst_number,client_code,identification_number,
        credit_limit,credit_duration_days,lead_source,source_description,has_whatsapp
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,
        $14,$15,$16,
        $17,$18,
        $19,$20,$21,$22,
        $23,$24,$25,
        $26,$27,$28,
        $29,$30,
        $31,$32,$33,$34,$35,
        $36,$37,$38,$39,$40
      ) RETURNING *`,
            [
                salonId,
                body.first_name.trim(),
                body.last_name ? body.last_name.trim() : null,
                fullName,
                body.email ?? null,
                body.phone_country_code ?? null,
                body.phone_number ?? null,
                body.additional_email ?? null,
                body.additional_phone_country_code ?? null,
                body.additional_phone_number ?? null,
                body.birthday_day_month || null,
                body.birthday_year || null,
                body.anniversary || null,
                body.gender ?? null,
                body.pronouns ?? null,
                body.address ?? null,
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
                referral.code,
                referral.rewardStatus,
                body.state ?? null,
                body.pincode ?? null,
                body.gst_number ?? null,
                body.client_code ?? null,
                body.identification_number ?? null,
                body.credit_limit ?? 0,
                body.credit_duration_days ?? 0,
                body.lead_source ?? null,
                body.source_description ?? null,
                body.has_whatsapp ?? true,
            ]
        );

        return rows[0];
    },

    // ---------------- REFERRAL ----------------
    async isReferralCodeTaken(code: string, salonId: string): Promise<boolean> {
        const { rows } = await pool.query(
            `SELECT 1 FROM clients WHERE salon_id = $1 AND referral_code = $2 LIMIT 1`,
            [salonId, code]
        );
        return rows.length > 0;
    },

    async findByReferralCode(code: string, salonId: string): Promise<Client | null> {
        const { rows } = await pool.query(
            `SELECT * FROM clients WHERE salon_id = $1 AND referral_code = $2`,
            [salonId, code]
        );
        return rows[0] || null;
    },

    async markReferralRewarded(clientId: string): Promise<void> {
        await pool.query(
            `UPDATE clients SET referral_reward_status = 'completed' WHERE id = $1`,
            [clientId]
        );
    },

    // Marks THIS client's own one-time welcome reward as granted (instant
    // discount or eWallet-credit fallback) — independent of
    // referral_reward_status, which only tracks the referrer's payout.
    async markRefereeRewarded(clientId: string): Promise<void> {
        await pool.query(
            `UPDATE clients SET referral_referee_rewarded = TRUE WHERE id = $1`,
            [clientId]
        );
    },

    // Bumps the canonical visit counter that loyalty-membership thresholds read.
    // Kept as a real incrementing column rather than a COUNT over appointments
    // because the two places that previously derived a visit count disagreed
    // (paid-only vs paid-or-partial), and a loyalty benefit needs one answer.
    async recordVisit(clientId: string, salonId: string): Promise<void> {
        await pool.query(
            `UPDATE clients
             SET total_visits = COALESCE(total_visits, 0) + 1
             WHERE id = $1 AND salon_id = $2`,
            [clientId, salonId]
        );
    },

    // Links a referred_by_code applied post-creation (e.g. at checkout) — kept
    // separate from the generic update() whitelist so a caller can never set
    // referral_reward_status directly through a normal client PATCH.
    async linkReferrer(clientId: string, referrerId: string): Promise<void> {
        await pool.query(
            `UPDATE clients SET referred_by_client_id = $1, referral_reward_status = 'pending' WHERE id = $2`,
            [referrerId, clientId]
        );
    },

    // Aggregated off ewallet_ledger (rather than a denormalized counter) so it
    // can never drift from what was actually credited. Scoped through the
    // referred clients themselves (c.referred_by_client_id = this client) so a
    // client's own one-time "referee welcome bonus" ledger entry — which also
    // has source_type='referral' but belongs to a *different* referral — is
    // never counted as this client's referrer earnings.
    // Basic info about the client who referred this one — for display only
    // (e.g. "Referred By" panel), so no salon_id scoping needed beyond the
    // caller already having resolved referredByClientId from a scoped row.
    async getReferrerInfo(referredByClientId: string): Promise<{ id: string; full_name: string; email: string | null; phone_country_code: string | null; phone_number: string | null; avatar_url: string | null } | null> {
        const { rows } = await pool.query(
            `SELECT id, full_name, email, phone_country_code, phone_number, avatar_url FROM clients WHERE id = $1`,
            [referredByClientId]
        );
        return rows[0] || null;
    },

    async getReferralStats(clientId: string): Promise<{ total_referral_earnings: number; total_successful_referrals: number }> {
        const { rows } = await pool.query(
            `SELECT COALESCE(SUM(el.amount), 0)::numeric AS total_earnings, COUNT(DISTINCT c.id)::int AS total_count
       FROM clients c
       JOIN ewallet_ledger el
         ON el.client_id = $1 AND el.source_type = 'referral' AND el.source_id = c.id
       WHERE c.referred_by_client_id = $1 AND c.referral_reward_status = 'completed'`,
            [clientId]
        );
        return {
            total_referral_earnings: parseFloat(rows[0]?.total_earnings ?? '0'),
            total_successful_referrals: Number(rows[0]?.total_count) || 0,
        };
    },

    // ---------------- UPDATE ----------------
    async update(clientId: string, patch: UpdateClientBody, salonId: string): Promise<Client> {
        const keys = Object.keys(patch) as (keyof UpdateClientBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(
                `SELECT * FROM clients WHERE id = $1 AND salon_id = $2`,
                [clientId, salonId]
            );
            return rows[0];
        }

        let full_name: string | undefined;
        if (patch.first_name !== undefined || patch.last_name !== undefined) {
            const existing = await this.findById(clientId, salonId);
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
            if (k === "addresses" || k === "emergency_contacts") continue;
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
            else if (k === "anniversary") add("anniversary", patch.anniversary || null);
            else if (k === "gender") add("gender", patch.gender ?? null);
            else if (k === "pronouns") add("pronouns", patch.pronouns ?? null);
            else if (k === "address") add("address", patch.address ?? null);
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
            else if (k === "state") add("state", patch.state ?? null);
            else if (k === "pincode") add("pincode", patch.pincode ?? null);
            else if (k === "gst_number") add("gst_number", patch.gst_number ?? null);
            else if (k === "client_code") add("client_code", patch.client_code ?? null);
            else if (k === "identification_number") add("identification_number", patch.identification_number ?? null);
            else if (k === "credit_limit") add("credit_limit", patch.credit_limit ?? 0);
            else if (k === "credit_duration_days") add("credit_duration_days", patch.credit_duration_days ?? 0);
            else if (k === "lead_source") add("lead_source", patch.lead_source ?? null);
            else if (k === "source_description") add("source_description", patch.source_description ?? null);
            else if (k === "has_whatsapp") add("has_whatsapp", patch.has_whatsapp ?? true);
        }

        if (full_name !== undefined) add("full_name", full_name);
        setParts.push(`updated_at = NOW()`);
        values.push(clientId);
        values.push(salonId);

        const { rows } = await pool.query(
            `UPDATE clients SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`,
            values
        );

        return rows[0];
    },

    // ---------------- RELATIONS UPSERT ----------------
    // skipDelete is set on the create path — a brand-new client has nothing
    // to delete yet, so that first DELETE was pure wasted work every time a
    // client was created with addresses/emergency_contacts attached.
    // Multi-row VALUES insert replaces the old per-item INSERT loop (N round
    // trips -> 1) for both paths.
    async replaceUpsertAddresses(clientId: string, items: Array<any>, skipDelete = false): Promise<ClientAddress[]> {
        if (!skipDelete && items.length === 0) {
            await pool.query(`DELETE FROM client_addresses WHERE client_id = $1`, [clientId]);
            return [];
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            if (!skipDelete) {
                await client.query(`DELETE FROM client_addresses WHERE client_id = $1`, [clientId]);
            }
            let inserted: ClientAddress[] = [];
            if (items.length) {
                const cols = 11;
                const values: unknown[] = [];
                const placeholders = items.map((a, i) => {
                    const base = i * cols;
                    values.push(
                        clientId, a.type, a.address_name ?? null, a.address_line1 ?? null,
                        a.address_line2 ?? null, a.apt_suite ?? null, a.district ?? null,
                        a.city ?? null, a.region ?? null, a.postcode ?? null, a.country ?? null,
                    );
                    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(",")})`;
                }).join(",");
                const { rows } = await client.query(
                    `INSERT INTO client_addresses (
            client_id, type, address_name, address_line1, address_line2, apt_suite, district, city, region, postcode, country
          ) VALUES ${placeholders}
          RETURNING *`,
                    values
                );
                inserted = rows;
            }
            await client.query("COMMIT");
            return inserted;
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async replaceUpsertEmergencyContacts(clientId: string, items: Array<any>, skipDelete = false): Promise<ClientEmergencyContact[]> {
        if (!skipDelete && items.length === 0) {
            await pool.query(`DELETE FROM client_emergency_contacts WHERE client_id = $1`, [clientId]);
            return [];
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            if (!skipDelete) {
                await client.query(`DELETE FROM client_emergency_contacts WHERE client_id = $1`, [clientId]);
            }
            let inserted: ClientEmergencyContact[] = [];
            if (items.length) {
                const cols = 7;
                const values: unknown[] = [];
                const placeholders = items.map((e, i) => {
                    const base = i * cols;
                    values.push(
                        clientId, e.type, e.full_name, e.relationship ?? null,
                        e.email ?? null, e.phone_country_code ?? null, e.phone_number ?? null,
                    );
                    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(",")})`;
                }).join(",");
                const { rows } = await client.query(
                    `INSERT INTO client_emergency_contacts (
            client_id, type, full_name, relationship, email, phone_country_code, phone_number
          ) VALUES ${placeholders}
          RETURNING *`,
                    values
                );
                inserted = rows;
            }
            await client.query("COMMIT");
            return inserted;
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    // ---------------- DELETE ----------------
    async softDelete(clientId: string, salonId: string): Promise<void> {
        await pool.query(
            `UPDATE clients SET is_active = false, updated_at = NOW() WHERE id = $1 AND salon_id = $2`,
            [clientId, salonId]
        );
    },

    async hardDelete(clientId: string, salonId: string): Promise<void> {
        await pool.query(`DELETE FROM clients WHERE id = $1 AND salon_id = $2`, [clientId, salonId]);
    },

    async blockClients(ids: string[], reason: string, salonId: string): Promise<void> {
        // Deliberately does NOT touch is_active — that's the "deleted" flag.
        // A blocked client stays fully visible/manageable in the salon's own
        // client list; only online booking (bookings.service.ts) checks
        // is_blocked to actually restrict them.
        await pool.query(
            `UPDATE clients SET is_blocked = true, block_reason = $1, updated_at = NOW()
             WHERE id = ANY($2::uuid[]) AND salon_id = $3`,
            [reason, ids, salonId]
        );
    },

    async unblockClients(ids: string[], salonId: string): Promise<void> {
        await pool.query(
            `UPDATE clients SET is_blocked = false, block_reason = NULL, updated_at = NOW()
             WHERE id = ANY($1::uuid[]) AND salon_id = $2`,
            [ids, salonId]
        );
    },

    // ---------------- IMPORT HELPERS ----------------
    async findExistingByEmailOrPhone(
        params: { email?: string | null; phone_country_code?: string | null; phone_number?: string | null },
        salonId: string
    ): Promise<Client | null> {
        const email = params.email ? String(params.email).trim() : null;
        const pcc = params.phone_country_code ? String(params.phone_country_code).trim() : null;
        const pn = params.phone_number ? String(params.phone_number).trim() : null;

        if (email) {
            const r = await pool.query(
                `SELECT * FROM clients WHERE email = $1 AND salon_id = $2 LIMIT 1`,
                [email, salonId]
            );
            if (r.rows[0]) return r.rows[0] as Client;
        }
        if (pcc && pn) {
            const r = await pool.query(
                `SELECT * FROM clients WHERE phone_country_code = $1 AND phone_number = $2 AND salon_id = $3 LIMIT 1`,
                [pcc, pn, salonId]
            );
            if (r.rows[0]) return r.rows[0] as Client;
        }
        // Best-effort: match by phone_number only when country code is absent.
        // WARNING: may return the wrong client if multiple clients share the same local
        // number under different country codes. The import flow treats this as a
        // skip (not a merge), so the worst outcome is a false duplicate detection.
        if (pn && !pcc) {
            const r = await pool.query(
                `SELECT * FROM clients WHERE TRIM(phone_number) = $1 AND salon_id = $2 LIMIT 1`,
                [pn, salonId]
            );
            if (r.rows[0]) {
                logger.warn("findExistingByEmailOrPhone: phone_country_code missing — best-effort match by phone_number only; may be ambiguous", {
                    phone_number: pn,
                    matched_client_id: r.rows[0].id,
                    salon_id: salonId,
                });
                return r.rows[0] as Client;
            }
        }
        return null;
    },

    // Enforces "one active client per phone number" at creation/edit time —
    // archived (is_active = false) clients are excluded so a genuinely removed
    // client's old number can be reused by someone new. excludeClientId lets
    // update() check without tripping over the client's own unchanged number.
    async findActiveByPhone(
        phone_number: string | null | undefined,
        salonId: string,
        excludeClientId?: string,
    ): Promise<Client | null> {
        const pn = phone_number ? String(phone_number).trim() : "";
        if (!pn) return null;
        // Matched on phone_number alone — NOT also phone_country_code. Many
        // existing rows have a NULL country code (added before it was tracked,
        // or via a flow that never set it), and NULL never equals '+91' in SQL —
        // so requiring both to match let a genuine duplicate phone slip through
        // undetected whenever the two records' country-code fields merely
        // *differed in form* despite being the same real number. Two distinct
        // real clients sharing one 10-digit number within a salon is
        // vanishingly rare; treating any match as a duplicate is the safe default.
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE salon_id = $1 AND is_active = true
               AND TRIM(phone_number) = $2
               AND ($3::uuid IS NULL OR id != $3)
             LIMIT 1`,
            [salonId, pn, excludeClientId ?? null]
        );
        return rows[0] || null;
    },

    // Mirrors findActiveByPhone — matches the ux_clients_salon_email DB index
    // (per-salon, case-insensitive, active clients only excluded the same way).
    async findActiveByEmail(
        email: string | null | undefined,
        salonId: string,
        excludeClientId?: string,
    ): Promise<Client | null> {
        const e = email ? String(email).trim().toLowerCase() : "";
        if (!e) return null;
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE salon_id = $1 AND is_active = true
               AND LOWER(TRIM(email)) = $2
               AND ($3::uuid IS NULL OR id != $3)
             LIMIT 1`,
            [salonId, e, excludeClientId ?? null]
        );
        return rows[0] || null;
    },

    // Combines findActiveByPhone + findActiveByEmail into a single round trip
    // for the create-time duplicate check — the two were previously two
    // sequential SELECTs where phone almost always makes email unnecessary.
    // Returns whichever active client matched phone OR email (either/both),
    // tagged so the caller can attribute the 409 to the right field without
    // a second query.
    async findActiveByPhoneOrEmail(
        phone_number: string | null | undefined,
        email: string | null | undefined,
        salonId: string,
    ): Promise<{ phoneMatch: Client | null; emailMatch: Client | null }> {
        const pn = phone_number ? String(phone_number).trim() : "";
        const e = email ? String(email).trim().toLowerCase() : "";
        if (!pn && !e) return { phoneMatch: null, emailMatch: null };

        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE salon_id = $1 AND is_active = true
               AND (
                 ($2 != '' AND TRIM(phone_number) = $2)
                 OR ($3 != '' AND LOWER(TRIM(email)) = $3)
               )
             LIMIT 2`,
            [salonId, pn, e]
        );

        let phoneMatch: Client | null = null;
        let emailMatch: Client | null = null;
        for (const row of rows) {
            if (!phoneMatch && pn && String(row.phone_number ?? "").trim() === pn) phoneMatch = row;
            if (!emailMatch && e && String(row.email ?? "").trim().toLowerCase() === e) emailMatch = row;
        }
        return { phoneMatch, emailMatch };
    },

    async findDuplicatesByPhone(phone_number: string, salonId: string): Promise<Client[]> {
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE TRIM(phone_number) = $1 AND salon_id = $2 AND is_active = true
             ORDER BY created_at ASC`,
            [phone_number.trim(), salonId]
        );
        return rows as Client[];
    },

    // ---------------- MERGE ----------------
    async mergeClients(params: {
        targetId: string;
        sourceIds: string[];
        strategy: MergeStrategy;
        salonId: string;
    }): Promise<{
        target_client_id: string;
        merged_source_client_ids: string[];
        archived_source_client_ids: string[];
        updated_fields: string[];
    }> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const targetRes = await client.query(
                `SELECT * FROM clients WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [params.targetId, params.salonId]
            );
            const target = targetRes.rows[0] as any;
            if (!target) throw new Error("Target client not found");

            const sourcesRes = await client.query(
                `SELECT * FROM clients WHERE id = ANY($1::uuid[]) AND salon_id = $2 FOR UPDATE`,
                [params.sourceIds, params.salonId]
            );
            const sources = sourcesRes.rows as any[];
            if (sources.length !== params.sourceIds.length)
                throw new Error("One or more source clients not found");

            const updated_fields: string[] = [];
            const isEmpty = (v: any) =>
                v === null || v === undefined || (typeof v === "string" && !v.trim());
            const apply = (field: string, value: any) => {
                target[field] = value;
                updated_fields.push(field);
            };

            if (params.strategy === "prefer_source") {
                for (const s of sources) {
                    for (const f of Object.keys(s)) {
                        if (["id", "created_at", "updated_at", "salon_id"].includes(f)) continue;
                        if (!isEmpty(s[f])) apply(f, s[f]);
                    }
                }
            } else if (params.strategy === "fill_missing_from_sources") {
                for (const s of sources) {
                    for (const f of Object.keys(s)) {
                        if (["id", "created_at", "updated_at", "salon_id"].includes(f)) continue;
                        if (isEmpty(target[f]) && !isEmpty(s[f])) apply(f, s[f]);
                    }
                }
            }

            const full_name = `${String(target.first_name || "").trim()} ${String(target.last_name || "").trim()}`.trim();
            if (target.full_name !== full_name) apply("full_name", full_name);

            const fieldsToUpdate = Array.from(new Set(updated_fields));
            if (fieldsToUpdate.length) {
                const setParts: string[] = [];
                const values: any[] = [];
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
                await client.query(`UPDATE clients SET updated_at = NOW() WHERE id = $1`, [params.targetId]);
            }

            await client.query(
                `UPDATE client_addresses SET client_id = $1 WHERE client_id = ANY($2::uuid[])`,
                [params.targetId, params.sourceIds]
            );
            await client.query(
                `DELETE FROM client_emergency_contacts
                 WHERE client_id = ANY($1::uuid[])
                 AND type IN (SELECT type FROM client_emergency_contacts WHERE client_id = $2)`,
                [params.sourceIds, params.targetId]
            );
            await client.query(
                `DELETE FROM client_emergency_contacts
                 WHERE id IN (
                     SELECT id FROM (
                         SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at ASC) as rn
                         FROM client_emergency_contacts WHERE client_id = ANY($1::uuid[])
                     ) t WHERE rn > 1
                 )`,
                [params.sourceIds]
            );
            await client.query(
                `UPDATE client_emergency_contacts SET client_id = $1 WHERE client_id = ANY($2::uuid[])`,
                [params.targetId, params.sourceIds]
            );
            await client.query(
                `UPDATE clients SET is_active = false, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                [params.sourceIds]
            );

            await client.query("COMMIT");

            return {
                target_client_id: params.targetId,
                merged_source_client_ids: params.sourceIds,
                archived_source_client_ids: params.sourceIds,
                updated_fields: fieldsToUpdate,
            };
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async findAllDuplicateGroups(salonId: string): Promise<Record<string, Client[]>> {
        const { rows } = await pool.query(
            `SELECT * FROM clients
             WHERE salon_id = $1 AND phone_number IS NOT NULL
               AND TRIM(phone_number) != '' AND is_active = true
               AND phone_number IN (
                   SELECT phone_number FROM clients
                   WHERE salon_id = $1 AND phone_number IS NOT NULL
                     AND TRIM(phone_number) != '' AND is_active = true
                   GROUP BY phone_number HAVING COUNT(*) > 1
               )
             ORDER BY phone_number, created_at ASC`,
            [salonId]
        );
        const groups: Record<string, Client[]> = {};
        for (const row of rows) {
            const phone = row.phone_number.trim();
            if (!groups[phone]) groups[phone] = [];
            groups[phone].push(row as Client);
        }
        return groups;
    },

    // ---------------- SEARCH ----------------
    async search(q: string, limit: number, salonId: string): Promise<Client[]> {
        const needle = q.trim().toLowerCase();
        const term = `%${needle}%`;
        const prefixTerm = `${needle}%`;

        // Relevance-ranked: exact name match first, then names starting with the
        // search term, then any other substring match (e.g. mid-name or phone
        // number) — alphabetical only as the final tiebreaker within each tier.
        // Without this, a plain `ORDER BY full_name ASC` put "Anita" ahead of a
        // closer/prefix match like "Nita ..." purely because A < N alphabetically.
        // This is the shared "pick a client for something new" search — Quick
        // Sale/Calendar's client picker, Calendar's top-bar lookup, and
        // selling a Package all go through it. A blocked client is excluded
        // here (not just from online booking) rather than just being
        // unselectable once found, so they don't show up at all — staff
        // manage/unblock a blocked client from the Clients list page, which
        // reads from a separate, unfiltered query.
        const { rows } = await pool.query(
            `SELECT id, first_name, last_name, full_name, email,
                    phone_country_code, phone_number, avatar_url, is_active, is_blocked, created_at, updated_at
             FROM clients
             WHERE salon_id = $1 AND is_active = true AND is_blocked = false
               AND (
                   LOWER(full_name) LIKE $2
                OR LOWER(COALESCE(phone_number, '')) LIKE $2
               )
             ORDER BY
               CASE
                 WHEN LOWER(full_name) = $4 THEN 0
                 WHEN LOWER(full_name) LIKE $5 THEN 1
                 WHEN LOWER(COALESCE(phone_number, '')) LIKE $5 THEN 2
                 ELSE 3
               END,
               full_name ASC
             LIMIT $3`,
            [salonId, term, limit, needle, prefixTerm]
        );

        return rows as Client[];
    },
    // ── NEW: Smart Filter for campaigns ──────────────────────────────────────
    _buildCampaignFilterSql(salonId: string, filters: CampaignFilterParams): { joinSql: string; where: string[]; params: any[] } {
        // Only require phone_number itself — phone_country_code is allowed to be
        // NULL (most clients in practice don't have it explicitly set) since the
        // SELECT below already defaults a missing country code to +91 via
        // COALESCE. Requiring it NOT NULL here silently excluded every client
        // without an explicit country code, regardless of any actual filter
        // criteria — confirmed live: 11 of 14 active clients in one salon were
        // being dropped by this alone.
        const where: string[] = [
            'c.salon_id = $1',
            'c.is_active = true',
            'c.phone_number IS NOT NULL',
            "TRIM(c.phone_number) <> ''",
        ]
        const params: any[] = [salonId]
        const joins: string[] = []

        if (filters.service_category_ids && filters.service_category_ids.length > 0) {
            params.push(filters.service_category_ids)
            joins.push(`
                JOIN appointments a ON a.client_id = c.id AND a.salon_id = $1
                JOIN services s ON s.id = ANY(
                    SELECT (item->>'service_id')::uuid
                    FROM jsonb_array_elements(a.services) AS item
                )
            `)
            where.push(`s.category_id = ANY($${params.length}::uuid[])`)
        }

        // Last-visit / new-vs-repetitive customer — shared computed join
        if (filters.last_visit_from || filters.last_visit_to || filters.customer_type) {
            joins.push(`
                LEFT JOIN (
                    SELECT client_id,
                           MAX(scheduled_at) FILTER (WHERE status = 'paid') AS last_visit_at,
                           COUNT(*)          FILTER (WHERE status = 'paid') AS completed_count
                    FROM appointments
                    WHERE salon_id = $1 AND deleted_at IS NULL
                    GROUP BY client_id
                ) av ON av.client_id = c.id
            `)
        }

        // Total spend — clients.total_sales is never written anywhere in the codebase
        // (dead column), so compute the real figure the same way Client History does.
        // Same sales ∪ still-open-partial-payments source as the `list()` method's
        // `ts` join above — summing `payments` alone missed every standalone
        // package/membership sale (Sell Package/Sell Membership never create a
        // payments row). Excludes eWallet/membership-wallet contributions from the
        // open-partial leg — that money was already recognized as revenue when the
        // wallet/membership was funded/sold — and the NOT EXISTS guard stops a
        // deposit from being double-counted once it's fully paid and gets its own
        // completed `sales` row.
        if (filters.total_spend_min != null || filters.total_spend_max != null) {
            joins.push(`
                LEFT JOIN (
                    SELECT client_id, COALESCE(SUM(amount), 0) AS total_spend
                    FROM (
                        SELECT s.client_id, s.total_amount AS amount
                        FROM sales s
                        LEFT JOIN appointments a ON a.id = s.appointment_id
                        WHERE s.salon_id = $1
                          AND s.status = 'completed'
                          AND s.client_id IS NOT NULL
                          AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
                        UNION ALL
                        SELECT p.client_id, GREATEST(0, p.paid_amount - COALESCE(p.ewallet_used, 0) - COALESCE(p.membership_wallet_used, 0)) AS amount
                        FROM payments p
                        JOIN appointments a ON a.id = p.appointment_id
                        WHERE p.salon_id = $1
                          AND p.status = 'partial'
                          AND p.client_id IS NOT NULL
                          AND a.deleted_at IS NULL
                          AND a.status NOT IN ('cancelled', 'no-show')
                          AND NOT EXISTS (
                            SELECT 1 FROM sales s2
                            WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
                          )
                    ) combined
                    GROUP BY client_id
                ) ps ON ps.client_id = c.id
            `)
        }

        if (filters.birth_month) {
            params.push(filters.birth_month)
            // Some client rows have malformed birthday_day_month values (e.g. a
            // full date like "2026-07-17" instead of "MM-DD") — calling TO_DATE
            // on those throws "date/time field value out of range" and crashes
            // the WHOLE query (Postgres doesn't guarantee AND short-circuits, so
            // a regex guard ANDed in isn't safe here). A CASE expression IS
            // guaranteed to only evaluate its matched branch per row, so
            // malformed rows just parse to NULL (never match) instead of
            // throwing.
            where.push(`
                EXTRACT(MONTH FROM (
                    CASE WHEN c.birthday_day_month ~ '^\\d{2}-\\d{2}$'
                         THEN TO_DATE(c.birthday_day_month, 'MM-DD')
                         ELSE NULL
                    END
                )) = $${params.length}
            `)
        }
        if (filters.birth_day_month) {
            params.push(filters.birth_day_month)
            where.push(`c.birthday_day_month = $${params.length}`)
        }
        if (filters.genders && filters.genders.length > 0) {
            params.push(filters.genders.map((g: string) => g.toLowerCase()))
            where.push(`LOWER(c.gender) = ANY($${params.length}::text[])`)
        }
        if (filters.client_source && filters.client_source !== 'all') {
            params.push(filters.client_source)
            where.push(`c.client_source = $${params.length}`)
        }
        if (filters.joined_from) {
            params.push(filters.joined_from)
            where.push(`c.created_at::date >= $${params.length}::date`)
        }
        if (filters.joined_to) {
            params.push(filters.joined_to)
            where.push(`c.created_at::date <= $${params.length}::date`)
        }
        if (filters.total_spend_min != null) {
            params.push(filters.total_spend_min)
            where.push(`COALESCE(ps.total_spend, 0) >= $${params.length}`)
        }
        if (filters.total_spend_max != null) {
            params.push(filters.total_spend_max)
            where.push(`COALESCE(ps.total_spend, 0) <= $${params.length}`)
        }
        if (filters.has_membership === true) {
            where.push(`EXISTS (SELECT 1 FROM client_memberships cm WHERE cm.client_id = c.id AND LOWER(cm.status) = 'active')`)
        } else if (filters.has_membership === false) {
            where.push(`NOT EXISTS (SELECT 1 FROM client_memberships cm WHERE cm.client_id = c.id AND LOWER(cm.status) = 'active')`)
        }
        if (filters.has_package === true) {
            where.push(`EXISTS (SELECT 1 FROM client_packages cp WHERE cp.client_id = c.id AND LOWER(cp.status) = 'active')`)
        } else if (filters.has_package === false) {
            where.push(`NOT EXISTS (SELECT 1 FROM client_packages cp WHERE cp.client_id = c.id AND LOWER(cp.status) = 'active')`)
        }
        if (filters.last_visit_from) {
            params.push(filters.last_visit_from)
            where.push(`av.last_visit_at::date >= $${params.length}::date`)
        }
        if (filters.last_visit_to) {
            params.push(filters.last_visit_to)
            where.push(`av.last_visit_at::date <= $${params.length}::date`)
        }
        if (filters.customer_type === 'new') {
            where.push(`COALESCE(av.completed_count, 0) = 0`)
        } else if (filters.customer_type === 'repetitive') {
            where.push(`COALESCE(av.completed_count, 0) > 0`)
        }

        return { joinSql: joins.join('\n'), where, params }
    },

    async filterForCampaign(salonId: string, filters: CampaignFilterParams): Promise<{ id: string; full_name: string; phone: string }[]> {
        const { joinSql, where, params } = this._buildCampaignFilterSql(salonId, filters)

        const { rows } = await pool.query(`
            SELECT DISTINCT
                c.id,
                c.full_name,
                CASE
                WHEN c.phone_number LIKE '+%' THEN c.phone_number
                ELSE CONCAT(COALESCE(c.phone_country_code, '+91'), c.phone_number)
                END AS phone
            FROM clients c
            ${joinSql}
            WHERE ${where.join(' AND ')}
            ORDER BY c.full_name ASC
        `, params)

        return rows
    },

    async countFilterForCampaign(salonId: string, filters: CampaignFilterParams): Promise<number> {
        const { joinSql, where, params } = this._buildCampaignFilterSql(salonId, filters)

        const { rows } = await pool.query(`
            SELECT COUNT(DISTINCT c.id)::int AS total
            FROM clients c
            ${joinSql}
            WHERE ${where.join(' AND ')}
        `, params)

        return rows[0]?.total ?? 0
    },
};