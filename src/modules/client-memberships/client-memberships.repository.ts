import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientMembership,
  ClientMembershipRow,
  UsageLogRow,
  CreateClientMembershipDTO,
  ConsumeSessionDTO,
  ClientMembershipsListQuery,
} from "./client-memberships.types";

export async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_memberships (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id        UUID         NOT NULL,
      client_id       UUID         NOT NULL,
      client_name     VARCHAR(255) NOT NULL DEFAULT '',
      mobile          VARCHAR(50),
      email           VARCHAR(255),
      membership_id   UUID         NOT NULL,
      membership_name VARCHAR(255) NOT NULL,
      colour          VARCHAR(50),
      total_sessions  INT          NOT NULL DEFAULT 0,
      used_sessions   INT          NOT NULL DEFAULT 0,
      purchased_at    TIMESTAMPTZ  DEFAULT NOW(),
      expires_at      TIMESTAMPTZ,
      status          VARCHAR(20)  NOT NULL DEFAULT 'active',
      price_paid      NUMERIC(10,2),
      created_at      TIMESTAMPTZ  DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  // Patch any columns missing from older table versions
  const patches = [
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS client_name     VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS mobile          VARCHAR(50)`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS email           VARCHAR(255)`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS membership_name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS colour          VARCHAR(50)`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS total_sessions  INT NOT NULL DEFAULT 0`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS used_sessions   INT NOT NULL DEFAULT 0`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS purchased_at    TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS status          VARCHAR(20) NOT NULL DEFAULT 'active'`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS price_paid      NUMERIC(10,2)`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of patches) {
    await pool.query(sql);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS membership_usage_log (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_membership_id  UUID        NOT NULL REFERENCES client_memberships(id) ON DELETE CASCADE,
      appointment_id        UUID,
      service_name          VARCHAR(255),
      sessions_consumed     INT         NOT NULL DEFAULT 1,
      notes                 TEXT,
      used_at               TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ── Row → domain ──────────────────────────────────────────────────────────────

function toClientMembership(row: ClientMembershipRow, log: UsageLogRow[] = []): ClientMembership {
  const total = Number(row.total_sessions);
  const used  = Number(row.used_sessions);
  return {
    id:                 row.id,
    salonId:            row.salon_id,
    clientId:           row.client_id,
    clientName:         row.client_name,
    mobile:             row.mobile  ?? undefined,
    email:              row.email   ?? undefined,
    membershipId:       row.membership_id,
    membershipName:     row.membership_name,
    colour:             row.colour  ?? undefined,
    totalSessions:      total,
    usedSessions:       used,
    remainingSessions:  total === 0 ? 9999 : Math.max(0, total - used),
    purchasedAt:        row.purchased_at,
    expiresAt:          row.expires_at ?? undefined,
    status:             row.status as ClientMembership['status'],
    pricePaid:          row.price_paid ? parseFloat(row.price_paid) : undefined,
    usageLog:           log.map(r => ({
      id:                  r.id,
      clientMembershipId:  r.client_membership_id,
      appointmentId:       r.appointment_id   ?? undefined,
      serviceName:         r.service_name     ?? undefined,
      sessionsConsumed:    r.sessions_consumed,
      notes:               r.notes            ?? undefined,
      usedAt:              r.used_at,
    })),
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export const clientMembershipsRepository = {

  async list(
    salonId: string,
    query: ClientMembershipsListQuery,
  ): Promise<{ items: ClientMembership[]; total: number }> {
    const conds: string[]  = ['salon_id = $1'];
    const vals:  any[]     = [salonId];
    let idx = 2;

    if (query.clientId) { conds.push(`client_id = $${idx++}`); vals.push(query.clientId); }
    if (query.status)   { conds.push(`status = $${idx++}`);    vals.push(query.status); }
    if (query.search) {
      conds.push(`(client_name ILIKE $${idx} OR membership_name ILIKE $${idx})`);
      vals.push(`%${query.search}%`); idx++;
    }

    const where  = `WHERE ${conds.join(' AND ')}`;
    const page   = Math.max(1, query.page  ?? 1);
    const limit  = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM client_memberships ${where}`, vals,
    );

    const { rows } = await pool.query(
      `SELECT * FROM client_memberships ${where} ORDER BY purchased_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...vals, limit, offset],
    );

    return {
      items: rows.map((r: ClientMembershipRow) => toClientMembership(r)),
      total: parseInt(countRes.rows[0].count, 10),
    };
  },

  async findById(id: string, salonId: string): Promise<ClientMembership | null> {
    const { rows } = await pool.query(
      `SELECT * FROM client_memberships WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    if (!rows.length) return null;

    const { rows: log } = await pool.query(
      `SELECT * FROM membership_usage_log WHERE client_membership_id = $1 ORDER BY used_at DESC`,
      [id],
    );
    return toClientMembership(rows[0], log);
  },

  async findActiveByClientAndMembership(
    clientId: string,
    membershipId: string,
    salonId: string,
  ): Promise<ClientMembership | null> {
    const { rows } = await pool.query(
      `SELECT * FROM client_memberships
       WHERE client_id = $1 AND membership_id = $2 AND salon_id = $3 AND status = 'active'
       ORDER BY purchased_at DESC LIMIT 1`,
      [clientId, membershipId, salonId],
    );
    return rows.length ? toClientMembership(rows[0]) : null;
  },

  async create(salonId: string, dto: CreateClientMembershipDTO): Promise<ClientMembership> {
    // Try to resolve client info; proceed even if client row is missing (fire-and-forget calls)
    let clientName = '';
    let mobile: string | null = null;
    let email: string | null  = null;

    try {
      const cRes = await pool.query(
        `SELECT COALESCE(full_name, (first_name || ' ' || COALESCE(last_name, ''))) AS name,
                phone_number, email
         FROM clients WHERE id = $1`,
        [dto.clientId],
      );
      if (cRes.rows.length) {
        const c = cRes.rows[0];
        clientName = (c.name ?? '').trim();
        mobile     = c.phone_number ?? null;
        email      = c.email        ?? null;
      }
    } catch { /* non-fatal */ }

    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO client_memberships
        (id, salon_id, client_id, client_name, mobile, email,
         membership_id, membership_name, colour, total_sessions, used_sessions,
         expires_at, status, price_paid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,'active',$12)
       RETURNING *`,
      [
        id, salonId, dto.clientId, clientName, mobile, email,
        dto.membershipId, dto.membershipName, dto.colour ?? null,
        dto.totalSessions,
        dto.expiresAt ?? null,
        dto.pricePaid ?? null,
      ],
    );
    return toClientMembership(rows[0]);
  },

  async consumeSession(
    id: string,
    salonId: string,
    dto: ConsumeSessionDTO,
  ): Promise<ClientMembership> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM client_memberships WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [id, salonId],
      );
      if (!rows.length) throw new Error('Sold membership not found');

      const cm      = rows[0] as ClientMembershipRow;
      const total   = Number(cm.total_sessions);
      const used    = Number(cm.used_sessions);
      const consume = dto.sessionsToConsume ?? 1;

      if (cm.status !== 'active') {
        throw new Error(`Membership is ${cm.status} and cannot be used`);
      }
      if (total > 0 && used + consume > total) {
        throw new Error(`Insufficient sessions — remaining: ${total - used}`);
      }

      const newUsed   = used + consume;
      const newStatus = (total > 0 && newUsed >= total) ? 'exhausted' : 'active';

      await client.query(
        `UPDATE client_memberships
         SET used_sessions = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newUsed, newStatus, id],
      );

      await client.query(
        `INSERT INTO membership_usage_log
          (id, client_membership_id, appointment_id, service_name, sessions_consumed, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          uuidv4(), id,
          dto.appointmentId ?? null,
          dto.serviceName   ?? null,
          consume,
          dto.notes         ?? null,
        ],
      );

      const { rows: updated } = await client.query(
        `SELECT * FROM client_memberships WHERE id = $1`, [id],
      );
      const { rows: log } = await client.query(
        `SELECT * FROM membership_usage_log WHERE client_membership_id = $1 ORDER BY used_at DESC`,
        [id],
      );

      await client.query('COMMIT');
      return toClientMembership(updated[0], log);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async cancel(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE client_memberships
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND salon_id = $2 AND status = 'active'`,
      [id, salonId],
    );
    return (rowCount ?? 0) > 0;
  },
};
