import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import {
  Membership, MembershipRow, CreateMembershipDTO,
  UpdateMembershipDTO, MembershipsListQuery, IncludedService,
} from "./memberships.types";

const SELECT_WITH_SERVICES = `
  SELECT m.*,
    COALESCE(
      json_agg(json_build_object('serviceId', s.id, 'serviceName', s.name))
      FILTER (WHERE s.id IS NOT NULL), '[]'
    ) AS services
  FROM memberships m
  LEFT JOIN membership_services ms ON ms.membership_id = m.id
  LEFT JOIN services s ON s.id = ms.service_id
`;

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    includedServices: row.services ?? [],
    sessionType: row.session_type,
    numberOfSessions: row.number_of_sessions ?? undefined,
    validFor: row.valid_for,
    price: parseFloat(row.price),
    taxRate: row.tax_rate ? parseFloat(row.tax_rate) : undefined,
    colour: row.colour,
    enableOnlineSales: row.enable_online_sales,
    enableOnlineRedemption: row.enable_online_redemption,
    termsAndConditions: row.terms_and_conditions ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const membershipsRepository = {

  async list(q: MembershipsListQuery): Promise<{ items: Membership[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    // search by name
    if (q.search) {
      conditions.push(`m.name ILIKE $${idx++}`);
      values.push(`%${q.search}%`);
    }
    // filter by sessionType
    if (q.sessionType && q.sessionType !== "any") {
      conditions.push(`m.session_type = $${idx++}`);
      values.push(q.sessionType);
    }
    // filter by validFor
    if (q.validFor && q.validFor !== "Any period") {
      conditions.push(`m.valid_for = $${idx++}`);
      values.push(q.validFor);
    }
    // filter by colour
    if (q.colour) {
      conditions.push(`m.colour = $${idx++}`);
      values.push(q.colour);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // count total without pagination
    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT m.id) FROM memberships m ${where}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page   = q.page  ?? 1;
    const limit  = q.limit ?? 20;
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} ${where} GROUP BY m.id ORDER BY m.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    return { items: rows.map(toMembership), total };
  },

  // export all (no pagination) for PDF/CSV
  async listAll(q: MembershipsListQuery): Promise<Membership[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (q.search) {
      conditions.push(`m.name ILIKE $${idx++}`);
      values.push(`%${q.search}%`);
    }
    if (q.sessionType && q.sessionType !== "any") {
      conditions.push(`m.session_type = $${idx++}`);
      values.push(q.sessionType);
    }
    if (q.validFor && q.validFor !== "Any period") {
      conditions.push(`m.valid_for = $${idx++}`);
      values.push(q.validFor);
    }
    if (q.colour) {
      conditions.push(`m.colour = $${idx++}`);
      values.push(q.colour);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} ${where} GROUP BY m.id ORDER BY m.created_at DESC`,
      values
    );
    return rows.map(toMembership);
  },

  async findById(id: string): Promise<Membership | null> {
    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [id]
    );
    return rows.length ? toMembership(rows[0]) : null;
  },

  async create(data: CreateMembershipDTO): Promise<Membership> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const membershipId = uuidv4();
      await client.query<MembershipRow>(
        `INSERT INTO memberships
          (id, name, description, session_type, number_of_sessions,
           valid_for, price, tax_rate, colour,
           enable_online_sales, enable_online_redemption, terms_and_conditions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          membershipId, data.name, data.description ?? null,
          data.sessionType, data.numberOfSessions ?? null,
          data.validFor, data.price, data.taxRate ?? null,
          data.colour, data.enableOnlineSales,
          data.enableOnlineRedemption, data.termsAndConditions ?? null,
        ]
      );
      await _linkServices(client, membershipId, data.includedServices);
      const { rows: full } = await client.query<MembershipRow>(
        `${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [membershipId]
      );
      await client.query("COMMIT");
      return toMembership(full[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, data: UpdateMembershipDTO): Promise<Membership | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const colMap: Record<string, string> = {
        name: "name", description: "description",
        sessionType: "session_type", numberOfSessions: "number_of_sessions",
        validFor: "valid_for", price: "price", taxRate: "tax_rate",
        colour: "colour", enableOnlineSales: "enable_online_sales",
        enableOnlineRedemption: "enable_online_redemption",
        termsAndConditions: "terms_and_conditions",
      };
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, col] of Object.entries(colMap)) {
        if (key in data) {
          fields.push(`${col} = $${idx++}`);
          values.push((data as any)[key] ?? null);
        }
      }
      if (fields.length > 0) {
        values.push(id);
        const res = await client.query(
          `UPDATE memberships SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id`,
          values
        );
        if (res.rowCount === 0) return null;
      }
      if (data.includedServices) {
        await client.query(`DELETE FROM membership_services WHERE membership_id = $1`, [id]);
        await _linkServices(client, id, data.includedServices);
      }
      const { rows } = await client.query<MembershipRow>(
        `${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [id]
      );
      await client.query("COMMIT");
      return rows.length ? toMembership(rows[0]) : null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(`DELETE FROM memberships WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  },
};

async function _linkServices(
  client: any, membershipId: string, services: IncludedService[]
): Promise<void> {
  for (const svc of services) {
    await client.query(
      `INSERT INTO membership_services (membership_id, service_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [membershipId, svc.serviceId]
    );
  }
}