import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientMembership,
  ClientMembershipRow,
  UsageLogRow,
  CreateClientMembershipDTO,
  ConsumeSessionDTO,
  ClientMembershipsListQuery,
  WalletDeductionServiceInput,
  WalletDeductionResult,
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
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS membership_wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0`,
    // Written alongside expires_at on every INSERT (see create() below) — was
    // previously only added manually against dev and missing from this patch
    // list, so environments where ensureTable() never got a matching manual
    // ALTER TABLE run (e.g. prod) had every membership purchase fail outright.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS end_date        TIMESTAMPTZ`,
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
  const usageLogPatches = [
    `ALTER TABLE membership_usage_log ADD COLUMN IF NOT EXISTS amount_deducted   NUMERIC(10,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE membership_usage_log ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(10,2)`,
    `ALTER TABLE membership_usage_log ADD COLUMN IF NOT EXISTS service_id        UUID`,
    `ALTER TABLE membership_usage_log ADD COLUMN IF NOT EXISTS client_id         UUID`,
    `ALTER TABLE membership_usage_log ADD COLUMN IF NOT EXISTS membership_id     UUID`,
  ];
  for (const sql of usageLogPatches) {
    await pool.query(sql);
  }

  await backfillLegacyWalletBalances();
}

// One-time (but safely re-runnable) backfill for rows created before the
// membership_wallet_balance column existed. Those rows got the column's
// static DEFAULT 0 instead of a real computed balance. Only touches rows
// that have literally never been through the wallet-deduction flow (no
// ledger entries), so a genuinely-exhausted membership is never "revived".
async function backfillLegacyWalletBalances(): Promise<void> {
  const { rows: candidates } = await pool.query(`
    SELECT cm.id, cm.membership_id
    FROM client_memberships cm
    WHERE cm.status = 'active'
      AND cm.membership_wallet_balance = 0
      AND NOT EXISTS (
        SELECT 1 FROM membership_usage_log ul
        WHERE ul.client_membership_id = cm.id AND ul.amount_deducted > 0
      )
  `);
  if (!candidates.length) return;

  for (const row of candidates) {
    const memRes = await pool.query(
      `SELECT price, description FROM memberships WHERE id = $1`,
      [row.membership_id],
    );
    const memRow = memRes.rows[0];
    if (!memRow) continue;

    let bonusCredit = 0;
    try { bonusCredit = Number(JSON.parse(memRow.description ?? "{}").bonusCredit) || 0; } catch { /* plain text description */ }
    const walletBalance = (Number(memRow.price) || 0) + bonusCredit;
    if (walletBalance <= 0) continue;

    await pool.query(
      `UPDATE client_memberships SET membership_wallet_balance = $1 WHERE id = $2`,
      [walletBalance, row.id],
    );
  }
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
    membershipWalletBalance: Number(row.membership_wallet_balance) || 0,
    appliesToProducts:  row.applies_to_products ?? false,
    usageLog:           log.map(r => ({
      id:                  r.id,
      clientMembershipId:  r.client_membership_id,
      appointmentId:       r.appointment_id   ?? undefined,
      serviceName:         r.service_name     ?? undefined,
      sessionsConsumed:    r.sessions_consumed,
      notes:               r.notes            ?? undefined,
      usedAt:              r.used_at,
      amountDeducted:      r.amount_deducted   != null ? Number(r.amount_deducted)   : undefined,
      remainingBalance:    r.remaining_balance != null ? Number(r.remaining_balance) : undefined,
      serviceId:           r.service_id        ?? undefined,
      clientId:            r.client_id         ?? undefined,
      membershipId:        r.membership_id     ?? undefined,
    })),
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

// ── Expiry helpers ───────────────────────────────────────────────────────────
// `end_date` is NOT NULL on client_memberships and is what expiry-reminder
// queries (e.g. WhatsApp automation) read — it must always be populated.

function computeExpiryDate(validFor: string | undefined | null): Date {
  const d = new Date();
  switch (validFor) {
    case '1 month':  d.setMonth(d.getMonth() + 1); break;
    case '3 months': d.setMonth(d.getMonth() + 3); break;
    case '6 months': d.setMonth(d.getMonth() + 6); break;
    case '1 year':   d.setFullYear(d.getFullYear() + 1); break;
    case 'lifetime':
    default:          d.setFullYear(d.getFullYear() + 50); break;
  }
  return d;
}

// ── Repository ────────────────────────────────────────────────────────────────

export const clientMembershipsRepository = {

  async list(
    salonId: string,
    query: ClientMembershipsListQuery,
  ): Promise<{ items: ClientMembership[]; total: number }> {
    const conds: string[]  = ['salon_id = $1'];
    const condsJoined: string[] = ['cm.salon_id = $1'];
    const vals:  any[]     = [salonId];
    let idx = 2;

    if (query.clientId) { conds.push(`client_id = $${idx}`); condsJoined.push(`cm.client_id = $${idx}`); idx++; vals.push(query.clientId); }
    if (query.status)   { conds.push(`status = $${idx}`);    condsJoined.push(`cm.status = $${idx}`);    idx++; vals.push(query.status); }
    if (query.search) {
      conds.push(`(client_name ILIKE $${idx} OR membership_name ILIKE $${idx})`);
      condsJoined.push(`(cm.client_name ILIKE $${idx} OR cm.membership_name ILIKE $${idx})`);
      vals.push(`%${query.search}%`); idx++;
    }

    const where       = `WHERE ${conds.join(' AND ')}`;
    const whereJoined = `WHERE ${condsJoined.join(' AND ')}`;
    const page   = Math.max(1, query.page  ?? 1);
    const limit  = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM client_memberships ${where}`, vals,
    );

    const { rows } = await pool.query(
      `SELECT cm.*, m.applies_to_products
       FROM client_memberships cm
       LEFT JOIN memberships m ON m.id = cm.membership_id
       ${whereJoined}
       ORDER BY cm.purchased_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
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

    // Resolve expiry + wallet funding from the catalog membership row itself —
    // authoritative regardless of what the caller passed, so the wallet is
    // always funded as (catalog price + bonusCredit) no matter which of the
    // several sell flows created this row.
    const memRes = await pool.query(
      `SELECT valid_for, price, description FROM memberships WHERE id = $1`,
      [dto.membershipId],
    );
    const memRow = memRes.rows[0];

    let expiresAt: Date | string | null = dto.expiresAt ?? null;
    if (!expiresAt) expiresAt = computeExpiryDate(memRow?.valid_for);

    let walletBalance = dto.pricePaid ?? 0;
    if (memRow) {
      let bonusCredit = 0;
      try { bonusCredit = Number(JSON.parse(memRow.description ?? "{}").bonusCredit) || 0; } catch { /* plain text description */ }
      walletBalance = (Number(memRow.price) || 0) + bonusCredit;
    }

    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO client_memberships
        (id, salon_id, client_id, client_name, mobile, email,
         membership_id, membership_name, colour, total_sessions, used_sessions,
         expires_at, end_date, status, price_paid, membership_wallet_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$11,'active',$12,$13)
       RETURNING *`,
      [
        id, salonId, dto.clientId, clientName, mobile, email,
        dto.membershipId, dto.membershipName, dto.colour ?? null,
        dto.totalSessions,
        expiresAt,
        dto.pricePaid ?? null,
        walletBalance,
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

  // ── Membership wallet ──────────────────────────────────────────────────────

  // All active memberships with a spendable balance, highest-balance first —
  // powers combined-total display and multi-membership checkout deduction
  // (deductWalletAcrossMemberships draws them down in this same order).
  async findAllActiveWithBalanceForClient(clientId: string, salonId: string): Promise<ClientMembership[]> {
    const { rows } = await pool.query(
      `SELECT * FROM client_memberships
       WHERE client_id = $1 AND salon_id = $2 AND status = 'active' AND membership_wallet_balance > 0
       ORDER BY membership_wallet_balance DESC`,
      [clientId, salonId],
    );
    return rows.map((r) => toClientMembership(r));
  },

  // True if any of the client's active, spendable memberships opted in to
  // covering products (per-membership toggle) — gates whether payments.service.ts
  // should feed product items into deductWalletAcrossMemberships at all.
  async hasProductEligibleMembership(clientId: string, salonId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
         WHERE cm.client_id = $1 AND cm.salon_id = $2 AND cm.status = 'active'
           AND cm.membership_wallet_balance > 0 AND m.applies_to_products = true
       ) AS exists`,
      [clientId, salonId],
    );
    return rows[0]?.exists === true;
  },

  // Read-only — for display/history use only. NOT used to decide reuse-vs-deduct
  // in the payment flow (that check must happen inside the locked transaction
  // below to avoid a double-spend race).
  async getWalletUsedForAppointment(appointmentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount_deducted),0) AS total FROM membership_usage_log WHERE appointment_id = $1`,
      [appointmentId],
    );
    return parseFloat(rows[0]?.total ?? '0');
  },

  // Per-item breakdown of wallet usage for one appointment, keyed by service_id
  // (which also holds the product's id for a product redemption — see
  // deductWalletAcrossMemberships below). Single source of truth for excluding
  // membership-covered amounts from tax (payments.service.ts) and staff
  // commission (commissionCalculation.service.ts) on a per-item basis.
  async getWalletUsedPerItemForAppointment(appointmentId: string): Promise<Map<string, number>> {
    const { rows } = await pool.query(
      `SELECT service_id, COALESCE(SUM(amount_deducted),0) AS used
       FROM membership_usage_log WHERE appointment_id = $1 AND service_id IS NOT NULL
       GROUP BY service_id`,
      [appointmentId],
    );
    return new Map(rows.map((r) => [String(r.service_id), parseFloat(r.used)]));
  },

  // Draws from several memberships in sequence (the order given in
  // clientMembershipIds, highest-balance-first) instead of just one — a
  // single service's amount can be split across multiple memberships if the
  // first one runs out mid-service. Idempotent per appointment, same locking
  // pattern as the rest of this module (FOR UPDATE + ledger check inside one
  // transaction to prevent a double-spend race on concurrent requests).
  async deductWalletAcrossMemberships(
    clientMembershipIds: string[],
    salonId: string,
    params: { appointmentId: string; services: WalletDeductionServiceInput[]; maxTotalAmount?: number },
  ): Promise<WalletDeductionResult> {
    if (clientMembershipIds.length === 0) {
      return { totalWalletUsed: 0, remainingBalance: 0, perService: [], reused: false };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM client_memberships WHERE id = ANY($1) AND salon_id = $2 FOR UPDATE`,
        [clientMembershipIds, salonId],
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return { totalWalletUsed: 0, remainingBalance: 0, perService: [], reused: false };
      }
      // WHERE id = ANY() doesn't preserve array order — re-sort into the
      // caller's intended draw-down order (highest-balance-first).
      const rowsById = new Map(rows.map((r) => [r.id, r as ClientMembershipRow]));
      const memberships = clientMembershipIds
        .map((id) => rowsById.get(id))
        .filter((r): r is ClientMembershipRow => !!r);

      // Idempotency check — MUST happen inside this same locked transaction,
      // same reasoning as the single-membership version above.
      const { rows: existing } = await client.query(
        `SELECT COALESCE(SUM(amount_deducted),0) AS total FROM membership_usage_log
         WHERE appointment_id = $1 AND client_membership_id = ANY($2)`,
        [params.appointmentId, clientMembershipIds],
      );
      const alreadyUsed = parseFloat(existing[0]?.total ?? '0');
      if (alreadyUsed > 0) {
        await client.query('ROLLBACK');
        const remainingBalance = memberships.reduce((sum, m) => sum + (Number(m.membership_wallet_balance) || 0), 0);
        return { totalWalletUsed: alreadyUsed, remainingBalance, perService: [], reused: true };
      }

      const remainingByMembership = memberships.map((m) => Number(m.membership_wallet_balance) || 0);
      let totalWalletUsed = 0;
      const perService: WalletDeductionResult['perService'] = [];
      // Staff-chosen cap (e.g. "only use ₹150 of the wallet, I'll collect the
      // rest via cash") — undefined/omitted means no cap beyond the wallet's
      // own balance, preserving the original "use as much as needed" behavior.
      const hasBudgetCap = params.maxTotalAmount != null;
      const budgetCap = hasBudgetCap ? Math.max(0, params.maxTotalAmount!) : Infinity;

      for (const svc of params.services) {
        if (totalWalletUsed >= budgetCap) break;
        const originalAmount = Number(svc.amount) || 0;
        let amountLeft = Math.min(originalAmount, budgetCap - totalWalletUsed);
        let svcWalletUsed = 0;
        const isUuid = typeof svc.serviceId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(svc.serviceId);

        for (let i = 0; i < memberships.length && amountLeft > 0; i++) {
          if (remainingByMembership[i] <= 0) continue;
          const used = Math.min(remainingByMembership[i], amountLeft);
          if (used <= 0) continue;

          remainingByMembership[i] -= used;
          amountLeft -= used;
          svcWalletUsed += used;
          totalWalletUsed += used;

          const cm = memberships[i];
          await client.query(
            `INSERT INTO membership_usage_log
              (id, client_membership_id, client_id, membership_id, appointment_id,
               service_id, service_name, sessions_consumed, amount_deducted, remaining_balance, notes)
             VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,0,$7,$8,NULL)`,
            [
              cm.id, cm.client_id, cm.membership_id, params.appointmentId,
              isUuid ? svc.serviceId : null, svc.serviceName || null, used, remainingByMembership[i],
            ],
          );
        }

        perService.push({ serviceId: svc.serviceId, walletUsed: svcWalletUsed, customerPays: Math.max(0, originalAmount - svcWalletUsed) });
      }

      for (let i = 0; i < memberships.length; i++) {
        const cm = memberships[i];
        const originalBalance = Number(cm.membership_wallet_balance) || 0;
        if (remainingByMembership[i] === originalBalance) continue; // untouched — skip the write
        const newStatus = remainingByMembership[i] <= 0 ? 'exhausted' : cm.status;
        await client.query(
          `UPDATE client_memberships SET membership_wallet_balance = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [remainingByMembership[i], newStatus, cm.id],
        );
      }

      await client.query('COMMIT');
      const remainingBalance = remainingByMembership.reduce((sum, v) => sum + v, 0);
      return { totalWalletUsed, remainingBalance, perService, reused: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
