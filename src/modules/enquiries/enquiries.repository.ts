import pool from "../../config/database";
import { CreateEnquiryBody, Enquiry, EnquiryListResponse, ListEnquiriesQuery, UpdateEnquiryBody } from "./enquiries.types";

const SELECT_FIELDS = `
  e.*,
  s.name AS service_name,
  CONCAT(st.first_name, ' ', st.last_name) AS staff_name
`;

const buildWhere = (query: ListEnquiriesQuery, salonId: string) => {
    const where: string[] = [];
    const values: unknown[] = [];

    values.push(salonId);
    where.push(`e.salon_id = $${values.length}`);

    if (query.search) {
        values.push(`%${query.search}%`);
        where.push(`(e.name ILIKE $${values.length} OR e.phone ILIKE $${values.length})`);
    }
    if (query.status) {
        values.push(query.status);
        where.push(`e.status = $${values.length}`);
    }

    return { whereSql: `WHERE ${where.join(" AND ")}`, values };
};

export const enquiriesRepository = {
    async findById(id: string, salonId: string): Promise<Enquiry | null> {
        const { rows } = await pool.query(
            `SELECT ${SELECT_FIELDS}
             FROM enquiries e
             LEFT JOIN services s ON s.id = e.service_id
             LEFT JOIN staff st ON st.id = e.staff_id
             WHERE e.id = $1 AND e.salon_id = $2`,
            [id, salonId],
        );
        return rows[0] || null;
    },

    async list(query: ListEnquiriesQuery, salonId: string): Promise<EnquiryListResponse> {
        const page = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 10)));
        const offset = (page - 1) * limit;
        const { whereSql, values } = buildWhere(query, salonId);

        const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM enquiries e ${whereSql}`, values);
        const total: number = countRes.rows[0]?.total ?? 0;

        const dataRes = await pool.query(
            `SELECT ${SELECT_FIELDS}
             FROM enquiries e
             LEFT JOIN services s ON s.id = e.service_id
             LEFT JOIN staff st ON st.id = e.staff_id
             ${whereSql}
             ORDER BY e.created_at DESC
             LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [...values, limit, offset],
        );

        return {
            data: dataRes.rows,
            pagination: { total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) },
        };
    },

    async create(data: CreateEnquiryBody, salonId: string): Promise<Enquiry> {
        // Per-salon sequential enquiry numbers (1, 2, 3, ...) — same
        // UPDATE...RETURNING counter pattern as sales.repository.ts's
        // invoice numbers. The row-level lock Postgres takes on the
        // salon's row for the UPDATE serializes concurrent inserts for
        // that salon, so two requests can never read the same next number.
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const { rows: seqRows } = await client.query(
                `UPDATE salons SET next_enquiry_seq = next_enquiry_seq + 1
                 WHERE id = $1 RETURNING next_enquiry_seq - 1 AS seq`,
                [salonId],
            );
            const enquiryNo = seqRows[0].seq;

            const { rows } = await client.query(
                `INSERT INTO enquiries (salon_id, enquiry_no, name, phone, service_id, staff_id, status, notes, source, follow_up_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 RETURNING id`,
                [
                    salonId,
                    enquiryNo,
                    data.name,
                    data.phone,
                    data.service_id ?? null,
                    data.staff_id ?? null,
                    data.status ?? "New",
                    data.notes ?? null,
                    data.source ?? null,
                    data.follow_up_at ?? null,
                ],
            );
            await client.query("COMMIT");
            return this.findById(rows[0].id, salonId) as Promise<Enquiry>;
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async update(id: string, patch: UpdateEnquiryBody, salonId: string): Promise<Enquiry | null> {
        const ALLOWED: ReadonlySet<string> = new Set(["name", "phone", "service_id", "staff_id", "status", "notes", "source", "follow_up_at"]);
        const raw = patch as Record<string, unknown>;
        const keys = Object.keys(raw).filter((k) => ALLOWED.has(k) && raw[k] !== undefined);

        if (!keys.length) return this.findById(id, salonId);

        const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
        const values: unknown[] = keys.map((k) => raw[k]);
        setParts.push(`updated_at = NOW()`);
        values.push(id, salonId);

        const { rows } = await pool.query(
            `UPDATE enquiries SET ${setParts.join(", ")}
             WHERE id = $${values.length - 1} AND salon_id = $${values.length}
             RETURNING id`,
            values,
        );
        if (!rows[0]) return null;
        return this.findById(id, salonId);
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM enquiries WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return (rowCount ?? 0) > 0;
    },
};
