import pool from "../../config/database";

export const salonModulesRepository = {
    // Salons (real + dummy) with the owner and how many modules are locked.
    async searchSalons(query: string) {
        const param = query ? `%${query.trim()}%` : "%";
        const { rows } = await pool.query(
            `
            SELECT
                s.id,
                COALESCE(s.business_name, s.slug, 'Unnamed')            AS name,
                s.is_active,
                s.is_dummy,
                u.email                                                  AS owner_email,
                TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS owner_name,
                (SELECT COUNT(*)::int FROM salon_module_locks l WHERE l.salon_id = s.id) AS locked_count
            FROM salons s
            LEFT JOIN users u ON u.id = s.owner_id
            WHERE (
                s.business_name ILIKE $1
                OR s.slug       ILIKE $1
                OR u.email      ILIKE $1
                OR u.first_name ILIKE $1
                OR u.last_name  ILIKE $1
            )
            ORDER BY s.business_name ASC
            LIMIT 100
            `,
            [param]
        );
        return rows;
    },

    async findSalon(salonId: string) {
        const { rows } = await pool.query(
            `
            SELECT
                s.id,
                COALESCE(s.business_name, s.slug, 'Unnamed')            AS name,
                s.is_active,
                u.email                                                  AS owner_email,
                TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS owner_name
            FROM salons s
            LEFT JOIN users u ON u.id = s.owner_id
            WHERE s.id = $1
            LIMIT 1
            `,
            [salonId]
        );
        return rows[0] ?? null;
    },

    async getLockedKeys(salonId: string): Promise<string[]> {
        const { rows } = await pool.query(
            `SELECT module_key FROM salon_module_locks WHERE salon_id = $1 ORDER BY module_key`,
            [salonId]
        );
        return rows.map((r) => r.module_key as string);
    },

    async getAuditLog(salonId: string, limit = 30) {
        const { rows } = await pool.query(
            `
            SELECT
                al.id, al.previous, al.new, al.created_at,
                TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS changed_by_name,
                u.email AS changed_by_email
            FROM salon_module_audit_log al
            LEFT JOIN users u ON u.id = al.changed_by
            WHERE al.salon_id = $1
            ORDER BY al.created_at DESC
            LIMIT $2
            `,
            [salonId, limit]
        );
        return rows;
    },

    // Replaces the salon's locked set with `locked` and records the change.
    // Lock rows and the audit row are written in ONE transaction so an access
    // change can never happen without its record. Returns what changed.
    async setLockedKeys(salonId: string, locked: string[], changedBy: string) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prevRows } = await client.query(
                `SELECT module_key FROM salon_module_locks WHERE salon_id = $1 ORDER BY module_key`,
                [salonId]
            );
            const previous = prevRows.map((r) => r.module_key as string);

            const prevSet = new Set(previous);
            const nextSet = new Set(locked);
            const toAdd = locked.filter((k) => !prevSet.has(k));
            const toRemove = previous.filter((k) => !nextSet.has(k));

            if (toRemove.length > 0) {
                await client.query(
                    `DELETE FROM salon_module_locks WHERE salon_id = $1 AND module_key = ANY($2::text[])`,
                    [salonId, toRemove]
                );
            }
            if (toAdd.length > 0) {
                await client.query(
                    `INSERT INTO salon_module_locks (salon_id, module_key, locked_by)
                     SELECT $1, k, $3 FROM UNNEST($2::text[]) AS k
                     ON CONFLICT (salon_id, module_key) DO NOTHING`,
                    [salonId, toAdd, changedBy]
                );
            }

            const changed = toAdd.length > 0 || toRemove.length > 0;
            // A salon's first-ever save is always recorded, even if it changes nothing (everything left
            // on): the audit row is what marks the salon as customized, so the admin page stops treating
            // it as a brand-new salon whose toggles all start Off.
            const { rows: auditRows } = await client.query(
                `SELECT 1 FROM salon_module_audit_log WHERE salon_id = $1 LIMIT 1`,
                [salonId]
            );
            if (changed || auditRows.length === 0) {
                await client.query(
                    `INSERT INTO salon_module_audit_log (salon_id, changed_by, previous, new)
                     VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
                    [salonId, changedBy, JSON.stringify(previous), JSON.stringify([...nextSet].sort())]
                );
            }

            await client.query("COMMIT");
            return { changed, locked: [...nextSet].sort(), added: toAdd, removed: toRemove };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
