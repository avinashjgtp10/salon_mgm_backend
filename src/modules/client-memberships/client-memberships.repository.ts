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
  DiscountDeductionServiceInput,
  DiscountDeductionResult,
} from "./client-memberships.types";
import type { MembershipAppliesTo } from "../memberships/memberships.types";
import { allocateMembershipDiscount } from "../pricing/pricing.engine";
import { AppError } from "../../middleware/error.middleware";

// Returns null (unrestricted) if ANY membership covering this bucket has no
// category restriction, else the union of every covering membership's
// allowed categories — mirrors the existing "OR across memberships" pattern
// already used for coversServices/coversProducts, since wallet balances are
// pooled across memberships the same way. Callers must only use this after
// confirming the bucket is actually covered (an empty `memberships` list
// would otherwise resolve to [] rather than the correct "not covered").
export function resolveCategoryRestriction(
  memberships: { appliesTo: MembershipAppliesTo; serviceCategoryIds: string[]; productCategoryIds: string[]; serviceIds?: string[]; productIds?: string[] }[],
  bucket: 'service' | 'product',
): string[] | null {
  const excludeSide = bucket === 'service' ? 'products' : 'services';
  const covering = memberships.filter((m) => m.appliesTo !== excludeSide);
  const catsOf = (m: typeof covering[number]) => (bucket === 'service' ? m.serviceCategoryIds : m.productCategoryIds) ?? [];
  const itemsOf = (m: typeof covering[number]) => (bucket === 'service' ? m.serviceIds : m.productIds) ?? [];
  // Unrestricted only when a covering membership has BOTH lists empty (for
  // THIS bucket) — a membership restricted to specific services only (empty
  // category ids, non-empty serviceIds) is still restricted, not
  // unrestricted. Checking category ids alone here would silently defeat the
  // whole item-restriction feature: it would mark the pool unrestricted
  // before serviceIds is ever consulted. Each side reads its OWN category id
  // list — a category valid for both services and products can be picked for
  // one without implicitly restricting the other.
  if (covering.some((m) => !catsOf(m).length && !itemsOf(m).length)) return null;
  return Array.from(new Set(covering.flatMap(catsOf)));
}

// Sibling of resolveCategoryRestriction, same pooling contract, for the
// item-level (specific service/product) restriction — uses the identical
// joint-unrestricted trigger, so this and resolveCategoryRestriction always
// return null together and callers can check either one's null-ness.
export function resolveItemRestriction(
  memberships: { appliesTo: MembershipAppliesTo; serviceCategoryIds: string[]; productCategoryIds: string[]; serviceIds?: string[]; productIds?: string[] }[],
  bucket: 'service' | 'product',
): string[] | null {
  const excludeSide = bucket === 'service' ? 'products' : 'services';
  const covering = memberships.filter((m) => m.appliesTo !== excludeSide);
  const catsOf = (m: typeof covering[number]) => (bucket === 'service' ? m.serviceCategoryIds : m.productCategoryIds) ?? [];
  const itemsOf = (m: typeof covering[number]) => (bucket === 'service' ? m.serviceIds : m.productIds) ?? [];
  if (covering.some((m) => !catsOf(m).length && !itemsOf(m).length)) return null;
  return Array.from(new Set(covering.flatMap(itemsOf)));
}

// Money is stored as NUMERIC(10,2); a percentage of an arbitrary line amount
// routinely produces more precision than that, so every arithmetic step is
// rounded to keep the running balance exactly reconstructable from the ledger.
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

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
    // NULL = a genuine standalone "Sell Membership" purchase (never otherwise
    // counted as revenue anywhere else). A real id means this row was
    // auto-created from paying an appointment that had this membership as a
    // line item — that value is already inside the appointment's own total,
    // so client-revenue aggregation must skip any row with this set.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL`,
    // Denormalized from the membership plan at purchase time — a sold
    // membership keeps the pricing terms it was bought under even if the plan
    // changes later, and the booking flow can read pricing type straight off
    // client_memberships with no extra lookup.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS pricing_type    VARCHAR(20) NOT NULL DEFAULT 'value'`,
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2)`,
    // The percentage type's depleting pool, seeded from the plan's discount_balance
    // at purchase. Depletes by the discount GIVEN, not by the service price — a
    // ₹1,000 service at 20% takes ₹200 off this, not ₹1,000.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS discount_balance_remaining NUMERIC(10,2) NOT NULL DEFAULT 0`,
    // Same denormalize-at-purchase pattern as pricing_type above. Genuinely
    // new — the OLDER applies_to_products boolean was never actually
    // denormalized here despite a comment once claiming it was: two read
    // paths (findAllActiveWithBalanceForClient, findActivePercentageForClient)
    // queried this table directly with no join to `memberships` at all, so
    // `appliesToProducts` silently read as `false` there regardless of the
    // plan's real setting — dead in practice for exactly the callers that
    // matter (the real percentage-discount charge-time gate). A real column
    // here removes the need for that join entirely.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'services'`,
    // Optional narrowing of applies_to to specific categories (blank/null =
    // unrestricted, matching every plan's behavior before this column
    // existed) — same denormalize-at-purchase convention as applies_to above.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS category_ids UUID[]`,
    // Plain-text description denormalized from the plan's JSON-encoded
    // memberships.description at purchase time (same convention as
    // pricing_type/applies_to above) — lets the calendar's membership
    // popover show it without a live lookup against the (possibly since
    // edited or deleted) catalog plan.
    `ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS description TEXT`,
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
//
// pricing_type = 'value' is required — only that type ever funds a spendable
// wallet (percentage/loyalty legitimately sit at 0 forever, see create()'s
// walletBalance assignment). Without this filter, this backfill — which
// re-runs on every server start via ensureTable() — funded a 'percentage'
// membership's wallet with its own price the first time it restarted after
// purchase (before any discount had been given yet, so it still looked like
// an untouched "legacy" row), incorrectly turning a Discount Balance plan
// into a second spendable wallet on top of its actual discount pool. That
// bogus balance then got treated as a real wallet source at checkout,
// corrupting the wallet-vs-discount ledger accounting for any bill that used
// both benefits together.
async function backfillLegacyWalletBalances(): Promise<void> {
  const { rows: candidates } = await pool.query(`
    SELECT cm.id, cm.membership_id
    FROM client_memberships cm
    WHERE cm.status = 'active'
      AND cm.pricing_type = 'value'
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
    appliesTo:          row.applies_to ?? 'services',
    serviceCategoryIds: row.service_category_ids ?? [],
    productCategoryIds: row.product_category_ids ?? [],
    serviceIds:         row.service_ids ?? [],
    productIds:         row.product_ids ?? [],
    description:        row.description ?? undefined,
    pricingType:        (row.pricing_type as ClientMembership['pricingType']) ?? 'value',
    discountPercent:    row.discount_percent != null ? Number(row.discount_percent) : undefined,
    discountBalanceRemaining: Number(row.discount_balance_remaining) || 0,
    appointmentId:      row.appointment_id ?? null,
    staffId:            row.staff_id ?? null,
    saleId:             row.sale_id ?? null,
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

function computeExpiryDate(validFor: string | undefined | null, from?: Date): Date {
  const d = from ? new Date(from.getTime()) : new Date();
  // Current plans store an exact "N days" duration (picked via a calendar in
  // the Add Membership modal) — the fixed buckets below only remain for plans
  // created before that change.
  const daysMatch = /^(\d+)\s*days?$/i.exec((validFor ?? '').trim());
  if (daysMatch) {
    d.setDate(d.getDate() + parseInt(daysMatch[1], 10));
    return d;
  }
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
    const vals:  any[]     = [salonId];
    let idx = 2;

    if (query.clientId) { conds.push(`client_id = $${idx}`); idx++; vals.push(query.clientId); }
    if (query.status)   { conds.push(`status = $${idx}`);    idx++; vals.push(query.status); }
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

    // applies_to is denormalized directly onto this table (see ensureTable's
    // patch list) — no join to `memberships` needed, unlike before.
    const { rows } = await pool.query(
      `SELECT * FROM client_memberships
       ${where}
       ORDER BY purchased_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
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
      `SELECT valid_for, price, description, pricing_type, discount_percent, discount_balance, applies_to, service_category_ids, product_category_ids, service_ids, product_ids
       FROM memberships WHERE id = $1`,
      [dto.membershipId],
    );
    const memRow = memRes.rows[0];

    let expiresAt: Date | string | null = dto.expiresAt ?? null;
    if (!expiresAt) expiresAt = computeExpiryDate(memRow?.valid_for);

    const pricingType = memRow?.pricing_type ?? 'value';
    // Loyalty plans enroll every client automatically off their visit count
    // (see memberships.repository.ts's findLoyaltyEligibility) — they have no
    // price to charge and never need a client_memberships row. Block it here,
    // not just in the frontend picker, since this same create() is also the
    // landing spot for autoCreateFromPayment (a membership sold as a line
    // item on an appointment) — one guard covers every sell entry point.
    if (pricingType === 'loyalty') {
      throw new AppError(400, 'Loyalty memberships enroll automatically and cannot be sold or purchased.', 'LOYALTY_NOT_SELLABLE');
    }
    const discountPercent = memRow?.discount_percent ?? null;
    const appliesTo = memRow?.applies_to ?? 'services';
    const serviceCategoryIds = memRow?.service_category_ids?.length ? memRow.service_category_ids : null;
    const productCategoryIds = memRow?.product_category_ids?.length ? memRow.product_category_ids : null;
    const serviceIds = memRow?.service_ids?.length ? memRow.service_ids : null;
    const productIds = memRow?.product_ids?.length ? memRow.product_ids : null;

    // description is JSON-encoded on the plan ({"description": "...", "bonusCredit": N})
    // — pull the plain text back out, falling back to the raw value for legacy
    // plans that stored plain text before the JSON convention existed.
    let description: string | null = null;
    if (memRow?.description) {
      try {
        const parsed = JSON.parse(memRow.description);
        description = typeof parsed?.description === 'string' && parsed.description.trim()
          ? parsed.description
          : null;
      } catch {
        description = memRow.description;
      }
    }

    // Only a 'value' plan funds a spendable wallet. A 'percentage' plan's fee buys
    // a discount pool instead, so leaving its wallet at 0 is what keeps it out of
    // deductWalletAcrossMemberships and the wallet benefit card entirely.
    let walletBalance = 0;
    let discountBalance = 0;
    if (pricingType === 'percentage') {
      discountBalance = Number(memRow?.discount_balance) || 0;
    } else {
      walletBalance = dto.pricePaid ?? 0;
      if (memRow) {
        let bonusCredit = 0;
        try { bonusCredit = Number(JSON.parse(memRow.description ?? "{}").bonusCredit) || 0; } catch { /* plain text description */ }
        walletBalance = (Number(memRow.price) || 0) + bonusCredit;
      }
    }

    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO client_memberships
        (id, salon_id, client_id, client_name, mobile, email,
         membership_id, membership_name, colour, total_sessions, used_sessions,
         expires_at, end_date, status, price_paid, membership_wallet_balance, appointment_id,
         pricing_type, discount_percent, discount_balance_remaining, applies_to, service_category_ids, product_category_ids, description, staff_id,
         service_ids, product_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$14,'active',$12,$13,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        id, salonId, dto.clientId, clientName, mobile, email,
        dto.membershipId, dto.membershipName, dto.colour ?? null,
        dto.totalSessions,
        expiresAt,
        dto.pricePaid ?? null,
        walletBalance,
        // expires_at (timestamptz) and end_date (date) can't share one $11
        // placeholder — Postgres infers a single type per parameter across
        // every occurrence in the statement, so reusing it for two differently
        // -typed columns is a genuine SQL error (42P08), not just a style
        // choice. Same value, its own placeholder.
        expiresAt,
        dto.appointmentId ?? null,
        pricingType,
        discountPercent,
        discountBalance,
        appliesTo,
        serviceCategoryIds,
        productCategoryIds,
        description,
        dto.staffId ?? null,
        serviceIds,
        productIds,
      ],
    );
    return toClientMembership(rows[0]);
  },

  // Re-buying a membership plan the client already has an ACTIVE row for
  // (autoCreateFromPayment's existing-row branch) used to just skip silently
  // — payment collected, nothing to show for it, and the sale invisible on
  // the Membership Sale report. This tops the existing row up instead: adds
  // the newly-funded wallet/discount-balance credit, extends expiry from
  // whichever is later (current expiry or now, so an early renewal doesn't
  // lose remaining time), adds the newly bought session count, and stamps
  // purchased_at/sale_id/staff_id to this renewal so it shows up as today's
  // activity on the report — same "authoritative from the catalog row"
  // funding math as create() above, not the raw price the client paid.
  async renew(
    id: string,
    salonId: string,
    dto: { membershipId: string; pricePaid: number; totalSessions: number; staffId?: string; saleId?: string },
  ): Promise<ClientMembership> {
    const { rows: existingRows } = await pool.query(
      `SELECT expires_at FROM client_memberships WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    const existing = existingRows[0];
    if (!existing) {
      throw new AppError(404, 'Membership record not found for renewal', 'MEMBERSHIP_NOT_FOUND');
    }

    const memRes = await pool.query(
      `SELECT valid_for, price, description, pricing_type, discount_balance
       FROM memberships WHERE id = $1`,
      [dto.membershipId],
    );
    const memRow = memRes.rows[0];
    const pricingType = memRow?.pricing_type ?? 'value';

    let walletTopUp = 0;
    let discountTopUp = 0;
    if (pricingType === 'percentage') {
      discountTopUp = Number(memRow?.discount_balance) || 0;
    } else if (memRow) {
      let bonusCredit = 0;
      try { bonusCredit = Number(JSON.parse(memRow.description ?? "{}").bonusCredit) || 0; } catch { /* plain text description */ }
      walletTopUp = (Number(memRow.price) || 0) + bonusCredit;
    }

    const currentExpiry = existing.expires_at ? new Date(existing.expires_at) : null;
    const extendFrom = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    const newExpiry = computeExpiryDate(memRow?.valid_for, extendFrom);

    const { rows } = await pool.query(
      `UPDATE client_memberships SET
         price_paid = COALESCE(price_paid, 0) + $1,
         membership_wallet_balance = membership_wallet_balance + $2,
         discount_balance_remaining = discount_balance_remaining + $3,
         total_sessions = total_sessions + $4,
         expires_at = $5,
         end_date = $5,
         status = 'active',
         purchased_at = NOW(),
         updated_at = NOW(),
         sale_id = COALESCE($6, sale_id),
         staff_id = COALESCE($7, staff_id)
       WHERE id = $8 AND salon_id = $9
       RETURNING *`,
      [dto.pricePaid ?? 0, walletTopUp, discountTopUp, dto.totalSessions ?? 0, newExpiry, dto.saleId ?? null, dto.staffId ?? null, id, salonId],
    );
    return toClientMembership(rows[0]);
  },

  // Links a client_memberships row to the sales row recordTransaction() (or
  // the checkout that bundled this membership) created for it — called
  // right after create(), once the sale id is known, so the Member Sale
  // report can look up invoice_no via a join.
  async setSaleId(id: string, salonId: string, saleId: string): Promise<void> {
    await pool.query(
      `UPDATE client_memberships SET sale_id = $1 WHERE id = $2 AND salon_id = $3`,
      [saleId, id, salonId],
    );
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

  // Whether the client's active, spendable memberships' wallets cover
  // services and/or products — gates whether payments.service.ts should feed
  // each item type into deductWalletAcrossMemberships at all. Reads the
  // denormalized applies_to directly off client_memberships (no join needed
  // — it's the sold instance's own terms, not necessarily the live plan's).
  // Services used to be unconditionally eligible (no exclusion existed); now
  // that a plan can be "products only," this has to gate both directions.
  async getWalletCoverageForClient(
    clientId: string, salonId: string,
  ): Promise<{
    coversServices: boolean; coversProducts: boolean;
    serviceCategoryIds: string[] | null; productCategoryIds: string[] | null;
    serviceItemIds: string[] | null; productItemIds: string[] | null;
  }> {
    const { rows } = await pool.query(
      `SELECT applies_to, service_category_ids, product_category_ids, service_ids, product_ids FROM client_memberships
       WHERE client_id = $1 AND salon_id = $2 AND status = 'active' AND membership_wallet_balance > 0`,
      [clientId, salonId],
    );
    let coversServices = false;
    let coversProducts = false;
    for (const r of rows) {
      const appliesTo = r.applies_to ?? 'services';
      if (appliesTo !== 'products') coversServices = true;
      if (appliesTo !== 'services') coversProducts = true;
    }
    const memberships = rows.map((r) => ({
      appliesTo: (r.applies_to ?? 'services') as MembershipAppliesTo,
      serviceCategoryIds: (r.service_category_ids ?? []) as string[],
      productCategoryIds: (r.product_category_ids ?? []) as string[],
      serviceIds: (r.service_ids ?? []) as string[],
      productIds: (r.product_ids ?? []) as string[],
    }));
    return {
      coversServices, coversProducts,
      serviceCategoryIds: coversServices ? resolveCategoryRestriction(memberships, 'service') : [],
      productCategoryIds: coversProducts ? resolveCategoryRestriction(memberships, 'product') : [],
      serviceItemIds: coversServices ? resolveItemRestriction(memberships, 'service') : [],
      productItemIds: coversProducts ? resolveItemRestriction(memberships, 'product') : [],
    };
  },

  // Also used by payments.service.ts as the "wallet checkbox unchecked on
  // this call, but a prior call on this appointment already deducted"
  // recovery path — MUST stay scoped to wallet-type rows only (notes IS
  // NULL, the tag deductWalletAcrossMemberships writes). Without this filter
  // it also summed 'membership_discount' rows from the SAME appointment,
  // so any appointment with both a membership discount and the wallet
  // checkbox unchecked at payment time reported the discount's ledger total
  // as phantom "already applied" wallet coverage — money the payment record
  // claimed was covered but was never actually deducted from any balance.
  async getWalletUsedForAppointment(appointmentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount_deducted),0) AS total FROM membership_usage_log WHERE appointment_id = $1 AND notes IS NULL`,
      [appointmentId],
    );
    return parseFloat(rows[0]?.total ?? '0');
  },

  // Per-item breakdown of wallet usage for one appointment, keyed by service_id
  // (which also holds the product's id for a product redemption — see
  // deductWalletAcrossMemberships below). Single source of truth for excluding
  // membership-covered amounts from tax (payments.service.ts) and staff
  // commission (commissionCalculation.service.ts) on a per-item basis. Scoped
  // to wallet-type rows only (notes IS NULL) — same reasoning as
  // getWalletUsedForAppointment above: an appointment that also had a
  // membership discount applied writes its own 'membership_discount' rows to
  // this same table, and without this filter they'd be misread as wallet
  // usage here too, corrupting both the tax exclusion and the commission base.
  async getWalletUsedPerItemForAppointment(appointmentId: string): Promise<Map<string, number>> {
    const { rows } = await pool.query(
      `SELECT service_id, COALESCE(SUM(amount_deducted),0) AS used
       FROM membership_usage_log WHERE appointment_id = $1 AND service_id IS NOT NULL AND notes IS NULL
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
      // same reasoning as the single-membership version above. Scoped to
      // wallet-type rows only (notes IS NULL) — a membership row that ALSO
      // wrote 'membership_discount' entries for this same appointment (a
      // percentage plan can end up in clientMembershipIds if its wallet
      // balance is non-zero) would otherwise make this see "already used"
      // from the discount's own ledger and short-circuit the real wallet
      // deduction entirely, reporting the discount's total as if it were
      // wallet coverage instead of ever touching the actual wallet balance.
      const { rows: existing } = await client.query(
        `SELECT COALESCE(SUM(amount_deducted),0) AS total FROM membership_usage_log
         WHERE appointment_id = $1 AND client_membership_id = ANY($2) AND notes IS NULL`,
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

      // Proportional split across items (params.services combines services
      // AND products, in caller-given order — see payments.service.ts's
      // itemsForWallet) — same principle as pricing.engine.ts's
      // allocateMembershipDiscount: when the available wallet can't cover
      // every item's full value, every eligible item loses the same
      // percentage of ITS OWN value, rather than fully draining earlier
      // items (by array position — services always listed first) before
      // later ones get anything. This used to mean an unrelated service
      // could silently zero out a product's wallet coverage just because it
      // appeared earlier in the array.
      const totalMembershipBalance = remainingByMembership.reduce((s, v) => s + v, 0);
      const combinedEligible = params.services.reduce((s, svc) => s + Math.max(0, Number(svc.amount) || 0), 0);
      const totalAvailable = Math.min(budgetCap, totalMembershipBalance);
      const ratio = combinedEligible > 0 ? Math.min(1, totalAvailable / combinedEligible) : 0;

      for (const svc of params.services) {
        const originalAmount = Number(svc.amount) || 0;
        let amountLeft = round2(originalAmount * ratio);
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

  // ── Discount balance ('percentage' memberships) ────────────────────────────

  // The single active percentage membership with discount left to give, richest
  // first. Unlike the wallet, a bill only ever draws from one — stacking two
  // percentage discounts on one service has no coherent meaning.
  async findActivePercentageForClient(clientId: string, salonId: string): Promise<ClientMembership | null> {
    const { rows } = await pool.query(
      `SELECT * FROM client_memberships
       WHERE client_id = $1 AND salon_id = $2 AND status = 'active'
         AND pricing_type = 'percentage' AND discount_balance_remaining > 0
         AND COALESCE(discount_percent, 0) > 0
       ORDER BY discount_balance_remaining DESC
       LIMIT 1`,
      [clientId, salonId],
    );
    return rows.length ? toClientMembership(rows[0]) : null;
  },

  async getDiscountGivenForAppointment(appointmentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount_deducted),0) AS total FROM membership_usage_log
       WHERE appointment_id = $1 AND notes = 'membership_discount'`,
      [appointmentId],
    );
    return parseFloat(rows[0]?.total ?? '0');
  },

  // Per-item breakdown of discount already given for this appointment, keyed
  // by service_id — mirrors getWalletUsedPerItemForAppointment. Needed so a
  // repeat payment call (partial → completing) can still exclude the
  // discounted portion of each row from GST/commission, not just the
  // aggregate bill total.
  async getDiscountGivenPerItemForAppointment(appointmentId: string): Promise<Map<string, number>> {
    const { rows } = await pool.query(
      `SELECT service_id, COALESCE(SUM(amount_deducted),0) AS used
       FROM membership_usage_log
       WHERE appointment_id = $1 AND notes = 'membership_discount' AND service_id IS NOT NULL
       GROUP BY service_id`,
      [appointmentId],
    );
    return new Map(rows.map((r) => [String(r.service_id), parseFloat(r.used)]));
  },

  // Deducts the DISCOUNT GIVEN (not the service price) from a percentage
  // membership's pool. Same locking/idempotency contract as
  // deductWalletAcrossMemberships — partial payments call the payment flow more
  // than once per appointment, so without the in-transaction ledger check the
  // same discount would be taken twice.
  //
  // Ledger rows are tagged notes='membership_discount' so they never get mixed
  // into the wallet's SUM(amount_deducted) reads, which are untagged.
  async deductDiscountBalanceForBooking(
    clientMembershipId: string,
    salonId: string,
    params: { appointmentId: string; services: DiscountDeductionServiceInput[]; discountPercent: number },
  ): Promise<DiscountDeductionResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM client_memberships WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [clientMembershipId, salonId],
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return { totalDiscountGiven: 0, remainingBalance: 0, perService: [], reused: false };
      }
      const cm = rows[0] as ClientMembershipRow;

      // Read back the FULL per-line breakdown, not just the sum — a second
      // call for this appointment (e.g. completing a partial payment) must
      // keep excluding each row's own already-given discount from GST, not
      // just the aggregate total. Previously this branch returned an empty
      // perService, silently losing per-row precision on exactly the repeat
      // calls where the discount was actually already committed.
      const { rows: existingRows } = await client.query(
        `SELECT service_id, service_name, amount_deducted FROM membership_usage_log
         WHERE appointment_id = $1 AND client_membership_id = $2 AND notes = 'membership_discount'
         ORDER BY used_at`,
        [params.appointmentId, clientMembershipId],
      );
      if (existingRows.length) {
        await client.query('ROLLBACK');
        const alreadyGiven = existingRows.reduce((s: number, r: any) => s + (Number(r.amount_deducted) || 0), 0);
        return {
          totalDiscountGiven: round2(alreadyGiven),
          remainingBalance: Number(cm.discount_balance_remaining) || 0,
          perService: existingRows.map((r: any) => ({ serviceId: r.service_id, discountGiven: Number(r.amount_deducted) || 0 })),
          reused: true,
        };
      }

      const balanceBefore = Number(cm.discount_balance_remaining) || 0;
      const { total: totalDiscountGiven, discounts } = allocateMembershipDiscount(
        params.services.map((s) => Number(s.amount) || 0),
        params.discountPercent,
        balanceBefore,
      );
      const perService: DiscountDeductionResult['perService'] = [];
      let remaining = balanceBefore;

      for (let i = 0; i < params.services.length; i++) {
        const discount = discounts[i];
        if (discount <= 0) continue;
        const svc = params.services[i];
        remaining = round2(remaining - discount);

        const isUuid = typeof svc.serviceId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(svc.serviceId);
        await client.query(
          `INSERT INTO membership_usage_log
            (id, client_membership_id, client_id, membership_id, appointment_id,
             service_id, service_name, sessions_consumed, amount_deducted, remaining_balance, notes)
           VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,0,$7,$8,'membership_discount')`,
          [
            cm.id, cm.client_id, cm.membership_id, params.appointmentId,
            isUuid ? svc.serviceId : null, svc.serviceName || null, discount, remaining,
          ],
        );
        perService.push({ serviceId: svc.serviceId, discountGiven: discount });
      }

      if (totalDiscountGiven > 0) {
        const newStatus = remaining <= 0 ? 'exhausted' : cm.status;
        await client.query(
          `UPDATE client_memberships
           SET discount_balance_remaining = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [remaining, newStatus, cm.id],
        );
      }

      await client.query('COMMIT');
      return { totalDiscountGiven, remainingBalance: remaining, perService, reused: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
