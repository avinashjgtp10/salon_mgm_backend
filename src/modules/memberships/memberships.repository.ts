import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import {
  Membership, MembershipRow, CreateMembershipDTO,
  UpdateMembershipDTO, MembershipsListQuery, IncludedService,
  LoyaltyEligibility,
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
    appliesTo: row.applies_to,
    pricingType: row.pricing_type,
    discountPercent: row.discount_percent ? parseFloat(row.discount_percent) : undefined,
    discountBalance: row.discount_balance ? parseFloat(row.discount_balance) : undefined,
    loyaltyThresholdValue: row.loyalty_threshold_value ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const membershipsRepository = {

  async list(q: MembershipsListQuery, salonId: string): Promise<{ items: Membership[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    // Always scope to salon
    conditions.push(`m.salon_id = $${idx++}`);
    values.push(salonId);

    if (q.search) { conditions.push(`m.name ILIKE $${idx++}`); values.push(`%${q.search}%`); }
    if (q.sessionType && q.sessionType !== "any") { conditions.push(`m.session_type = $${idx++}`); values.push(q.sessionType); }
    if (q.validFor && q.validFor !== "Any period") { conditions.push(`m.valid_for = $${idx++}`); values.push(q.validFor); }
    if (q.colour) { conditions.push(`m.colour = $${idx++}`); values.push(q.colour); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT m.id) FROM memberships m ${where}`, values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} ${where} GROUP BY m.id ORDER BY m.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    return { items: rows.map(toMembership), total };
  },

  async listAll(q: MembershipsListQuery, salonId: string): Promise<Membership[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    conditions.push(`m.salon_id = $${idx++}`);
    values.push(salonId);

    if (q.search) { conditions.push(`m.name ILIKE $${idx++}`); values.push(`%${q.search}%`); }
    if (q.sessionType && q.sessionType !== "any") { conditions.push(`m.session_type = $${idx++}`); values.push(q.sessionType); }
    if (q.validFor && q.validFor !== "Any period") { conditions.push(`m.valid_for = $${idx++}`); values.push(q.validFor); }
    if (q.colour) { conditions.push(`m.colour = $${idx++}`); values.push(q.colour); }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} ${where} GROUP BY m.id ORDER BY m.created_at DESC`, values
    );
    return rows.map(toMembership);
  },

  async findById(id: string, salonId: string): Promise<Membership | null> {
    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} WHERE m.id = $1 AND m.salon_id = $2 GROUP BY m.id`,
      [id, salonId]
    );
    return rows.length ? toMembership(rows[0]) : null;
  },

  async findByName(name: string, salonId: string): Promise<Membership | null> {
    const { rows } = await pool.query(
      `${SELECT_WITH_SERVICES} WHERE m.salon_id = $1 AND LOWER(m.name) = LOWER($2) GROUP BY m.id LIMIT 1`,
      [salonId, name]
    );
    return rows.length ? toMembership(rows[0]) : null;
  },

  // Loyalty plans are salon-wide and free — there is no per-client row to look
  // up, so eligibility is evaluated live against the client's accumulated
  // visits. Returns the single best-value qualifying plan, or the
  // closest-to-unlocking one so the UI can show progress ("7 of 10 visits")
  // rather than nothing at all.
  async findLoyaltyEligibility(
    clientId: string,
    salonId: string,
  ): Promise<LoyaltyEligibility | null> {
    const { rows: planRows } = await pool.query(
      `SELECT id, name, discount_percent, loyalty_threshold_value, applies_to
       FROM memberships
       WHERE salon_id = $1 AND pricing_type = 'loyalty'
         AND COALESCE(discount_percent, 0) > 0
         AND loyalty_threshold_value IS NOT NULL`,
      [salonId],
    );
    if (!planRows.length) return null;

    const { rows: clientRows } = await pool.query(
      `SELECT total_visits FROM clients WHERE id = $1 AND salon_id = $2`,
      [clientId, salonId],
    );
    if (!clientRows.length) return null;
    const totalVisits = Number(clientRows[0].total_visits) || 0;

    const evaluated: LoyaltyEligibility[] = planRows.map((p) => {
      const thresholdValue = Number(p.loyalty_threshold_value) || 0;
      return {
        membershipId: p.id,
        name: p.name,
        discountPercent: Number(p.discount_percent) || 0,
        thresholdValue,
        current: totalVisits,
        eligible: totalVisits >= thresholdValue,
        appliesTo: p.applies_to ?? 'services',
      };
    });

    const unlocked = evaluated.filter((e) => e.eligible);
    if (unlocked.length) {
      return unlocked.reduce((best, e) => (e.discountPercent > best.discountPercent ? e : best));
    }
    return evaluated.reduce((closest, e) =>
      (e.thresholdValue - e.current) < (closest.thresholdValue - closest.current) ? e : closest);
  },

  async create(data: CreateMembershipDTO, salonId: string): Promise<Membership> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const membershipId = uuidv4();
      await client.query<MembershipRow>(
        `INSERT INTO memberships
          (id, salon_id, name, description, session_type, number_of_sessions,
           valid_for, price, tax_rate, colour,
           enable_online_sales, enable_online_redemption, terms_and_conditions,
           applies_to, pricing_type, discount_percent,
           discount_balance, loyalty_threshold_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          membershipId, salonId, data.name, data.description ?? null,
          data.sessionType, data.numberOfSessions ?? null,
          data.validFor, data.price, data.taxRate ?? null,
          data.colour, data.enableOnlineSales,
          data.enableOnlineRedemption, data.termsAndConditions ?? null,
          data.appliesTo ?? 'services',
          data.pricingType ?? 'value', data.discountPercent ?? null,
          data.discountBalance ?? null,
          data.loyaltyThresholdValue ?? null,
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

  async update(id: string, data: UpdateMembershipDTO, salonId: string): Promise<Membership | null> {
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
        appliesTo: "applies_to",
        pricingType: "pricing_type",
        discountPercent: "discount_percent",
        discountBalance: "discount_balance",
        loyaltyThresholdValue: "loyalty_threshold_value",
      };
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, col] of Object.entries(colMap)) {
        if (key in data) { fields.push(`${col} = $${idx++}`); values.push((data as any)[key] ?? null); }
      }
      if (fields.length > 0) {
        values.push(id);
        values.push(salonId);
        const res = await client.query(
          `UPDATE memberships SET ${fields.join(", ")}
           WHERE id = $${idx} AND salon_id = $${idx + 1}
           RETURNING id`,
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

  async delete(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM memberships WHERE id = $1 AND salon_id = $2`, [id, salonId]
    );
    return (rowCount ?? 0) > 0;
  },
};

async function _linkServices(
  client: any, membershipId: string, services: IncludedService[]
): Promise<void> {
  for (const svc of services) {
    await client.query(
      `INSERT INTO membership_services (membership_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [membershipId, svc.serviceId]
    );
  }
}