"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipsRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
const uuid_1 = require("uuid");
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
function toMembership(row) {
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
exports.membershipsRepository = {
    async list(_q) {
        const { rows } = await database_1.default.query(`${SELECT_WITH_SERVICES} GROUP BY m.id ORDER BY m.created_at DESC`);
        return { items: rows.map(toMembership), total: rows.length };
    },
    async findById(id) {
        const { rows } = await database_1.default.query(`${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [id]);
        return rows.length ? toMembership(rows[0]) : null;
    },
    async create(data) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            const membershipId = (0, uuid_1.v4)();
            await client.query(`INSERT INTO memberships
          (id, name, description, session_type, number_of_sessions,
           valid_for, price, tax_rate, colour,
           enable_online_sales, enable_online_redemption, terms_and_conditions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
                membershipId, // $1
                data.name, // $2
                data.description ?? null, // $3
                data.sessionType, // $4
                data.numberOfSessions ?? null, // $5
                data.validFor, // $6
                data.price, // $7
                data.taxRate ?? null, // $8
                data.colour, // $9
                data.enableOnlineSales, // $10
                data.enableOnlineRedemption, // $11
                data.termsAndConditions ?? null, // $12
            ]);
            await _linkServices(client, membershipId, data.includedServices);
            const { rows: full } = await client.query(`${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [membershipId]);
            await client.query("COMMIT");
            return toMembership(full[0]);
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
    async update(id, data) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            const colMap = {
                name: "name",
                description: "description",
                sessionType: "session_type",
                numberOfSessions: "number_of_sessions",
                validFor: "valid_for",
                price: "price",
                taxRate: "tax_rate",
                colour: "colour",
                enableOnlineSales: "enable_online_sales",
                enableOnlineRedemption: "enable_online_redemption",
                termsAndConditions: "terms_and_conditions",
            };
            const fields = [];
            const values = [];
            let idx = 1;
            for (const [key, col] of Object.entries(colMap)) {
                if (key in data) {
                    fields.push(`${col} = $${idx++}`);
                    values.push(data[key] ?? null);
                }
            }
            if (fields.length > 0) {
                values.push(id);
                const res = await client.query(`UPDATE memberships SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id`, values);
                if (res.rowCount === 0)
                    return null;
            }
            if (data.includedServices) {
                await client.query(`DELETE FROM membership_services WHERE membership_id = $1`, [id]);
                await _linkServices(client, id, data.includedServices);
            }
            const { rows } = await client.query(`${SELECT_WITH_SERVICES} WHERE m.id = $1 GROUP BY m.id`, [id]);
            await client.query("COMMIT");
            return rows.length ? toMembership(rows[0]) : null;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
    async delete(id) {
        const { rowCount } = await database_1.default.query(`DELETE FROM memberships WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },
};
async function _linkServices(client, membershipId, services) {
    for (const svc of services) {
        // Services already exist in the DB — just link them via the junction table.
        // Do NOT insert into `services` table (it has NOT NULL constraints on price, category_id, etc.)
        await client.query(`INSERT INTO membership_services (membership_id, service_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`, [membershipId, svc.serviceId]);
    }
}
//# sourceMappingURL=memberships.repository.js.map