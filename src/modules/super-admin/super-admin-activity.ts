import type { NextFunction, Request, Response } from "express";
import pool from "../../config/database";
import logger from "../../config/logger";

// Super Admin > Client Activity Management > Developer Activity: what the Super Admin OWNER account did. Developers (team members who also
// have a Super Admin login) are deliberately not shown there: only this one account's activity is.
//
// The feed joins four sources, all filtered to the owner as the person who acted:
//   - super_admin_activity_log   account created / edited / blocked / role changed / password reset / impersonated, salon status ...
//                                 (written by the middleware below, for every non-GET request that succeeds)
//   - deleted_account_log        accounts and salons deleted (already written by the delete flow, with a snapshot of who/what)
//   - salon_cleanup_log          salon data cleared (already written by the clear-data flow)
//   - client_activity_audit_logs meetings, follow-ups, activity entries and training the owner worked on

export const SUPER_ADMIN_OWNER_EMAIL = (process.env.SUPER_ADMIN_OWNER_EMAIL || "avinash@salonox.com").trim().toLowerCase();

// ── Writing ───────────────────────────────────────────────────────────────────

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS super_admin_activity_log (
           id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           actor_id     UUID NOT NULL,
           actor_email  VARCHAR(255),
           action       VARCHAR(60) NOT NULL,
           entity_type  VARCHAR(30),
           entity_id    TEXT,
           entity_label VARCHAR(255),
           details      JSONB,
           created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS idx_sa_activity_actor ON super_admin_activity_log (actor_id, created_at DESC);`,
      )
      .then(() => undefined)
      .catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

type Rule = {
  method: string;
  re: RegExp;
  action: string;
  entity: "user" | "salon" | "demo_request" | "invoice" | "payment_gateway" | "billing_issue";
  /** Which capture group is the entity id (0 = none, the label comes from the request body). */
  idGroup: number;
  /** Safe fields to keep from the request body (never passwords or tokens). */
  keep?: string[];
  /** Builds the details instead of `keep`, for bodies whose values must not be stored. */
  describe?: (body: any) => Record<string, unknown> | null;
};

// Which payment settings were submitted. Names only: a key or secret is never written to the log.
const GATEWAY_FIELDS: [string, string][] = [["key_id", "Key ID"], ["key_secret", "Key Secret"], ["webhook_secret", "Webhook Secret"], ["subscription_currencies", "Currencies"]];
const changedGatewayFields = (body: any) => {
  const names = GATEWAY_FIELDS.filter(([k]) => String(body?.[k] ?? "").trim()).map(([, label]) => label);
  return names.length ? { changed: names.join(", ") } : null;
};

// Deletes and data clears are not listed: they already have their own, richer log (deleted_account_log / salon_cleanup_log).
const RULES: Rule[] = [
  { method: "POST", re: /^\/users\/create$/, action: "account_created", entity: "user", idGroup: 0, keep: ["role", "first_name", "last_name"] },
  { method: "PUT", re: /^\/users\/([^/]+)$/, action: "account_updated", entity: "user", idGroup: 1, keep: ["role", "first_name", "last_name", "phone"] },
  { method: "PATCH", re: /^\/users\/([^/]+)\/status$/, action: "account_status_changed", entity: "user", idGroup: 1, keep: ["is_active", "status"] },
  { method: "PATCH", re: /^\/users\/([^/]+)\/role$/, action: "account_role_changed", entity: "user", idGroup: 1, keep: ["role"] },
  { method: "POST", re: /^\/users\/([^/]+)\/reset-password$/, action: "password_reset", entity: "user", idGroup: 1 },
  { method: "POST", re: /^\/users\/([^/]+)\/impersonate$/, action: "account_impersonated", entity: "user", idGroup: 1 },
  { method: "PUT", re: /^\/users\/([^/]+)\/branch-salons$/, action: "branch_salons_assigned", entity: "user", idGroup: 1 },
  { method: "DELETE", re: /^\/users\/([^/]+)\/branch-salons\/[^/]+$/, action: "branch_salon_unassigned", entity: "user", idGroup: 1 },
  { method: "PATCH", re: /^\/salons\/([^/]+)\/status$/, action: "salon_status_changed", entity: "salon", idGroup: 1, keep: ["is_active", "status"] },
  { method: "PATCH", re: /^\/salons\/([^/]+)\/dummy$/, action: "salon_dummy_changed", entity: "salon", idGroup: 1, keep: ["is_dummy"] },
  { method: "PATCH", re: /^\/salons\/([^/]+)\/onboarding$/, action: "salon_onboarding_forced", entity: "salon", idGroup: 1 },
  { method: "POST", re: /^\/salons\/([^/]+)\/impersonate$/, action: "salon_impersonated", entity: "salon", idGroup: 1 },
  { method: "POST", re: /^\/salons\/([^/]+)\/restore$/, action: "salon_restored", entity: "salon", idGroup: 1 },
  { method: "PUT", re: /^\/salon-permissions\/([^/]+)$/, action: "salon_permissions_updated", entity: "salon", idGroup: 1 },
  { method: "PATCH", re: /^\/demo-requests\/([^/]+)\/status$/, action: "demo_request_status_changed", entity: "demo_request", idGroup: 1, keep: ["status"] },
  { method: "POST", re: /^\/salons\/([^/]+)\/invoices$/, action: "salon_invoice_created", entity: "invoice", idGroup: 1 },
  { method: "GET", re: /^\/payment-gateway\/reveal$/, action: "payment_keys_viewed", entity: "payment_gateway", idGroup: 0 },
  { method: "PUT", re: /^\/payment-gateway$/, action: "payment_keys_changed", entity: "payment_gateway", idGroup: 0, describe: changedGatewayFields },
  { method: "DELETE", re: /^\/payment-gateway$/, action: "payment_keys_deleted", entity: "payment_gateway", idGroup: 0 },
  { method: "POST", re: /^\/billing-issues\/([^/]+)\/resolve$/, action: "billing_issue_resolved", entity: "billing_issue", idGroup: 1, keep: ["note"] },
  { method: "POST", re: /^\/billing-issues\/([^/]+)\/retry-stop$/, action: "billing_issue_stop_retried", entity: "billing_issue", idGroup: 1 },
];

function pick(body: any, keys?: string[]): Record<string, unknown> | null {
  if (!keys?.length || !body || typeof body !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (body[k] !== undefined && typeof body[k] !== "object") out[k] = body[k];
  return Object.keys(out).length ? out : null;
}

async function labelFor(entity: Rule["entity"], id: string | null, body: any): Promise<string | null> {
  try {
    if (entity === "user" && !id) return String(body?.email ?? "").trim() || null;
    if (!id) return null;
    if (entity === "user") return (await pool.query(`SELECT email FROM users WHERE id::text = $1`, [id])).rows[0]?.email ?? null;
    if (entity === "salon" || entity === "invoice") return (await pool.query(`SELECT COALESCE(business_name, slug) AS n FROM salons WHERE id::text = $1`, [id])).rows[0]?.n ?? null;
    return null;
  } catch { return null; }
}

async function record(req: Request, rule: Rule, match: RegExpMatchArray): Promise<void> {
  const actorId = (req as any).user?.userId as string | undefined;
  if (!actorId) return;
  const entityId = rule.idGroup ? match[rule.idGroup] : null;
  await ensureTable();
  const [{ rows: a }, label] = await Promise.all([
    pool.query(`SELECT email FROM users WHERE id = $1`, [actorId]),
    labelFor(rule.entity, entityId, req.body),
  ]);
  await pool.query(
    `INSERT INTO super_admin_activity_log (actor_id, actor_email, action, entity_type, entity_id, entity_label, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, a[0]?.email ?? null, rule.action, rule.entity, entityId, rule.entity === "payment_gateway" ? "Razorpay keys" : label,
     rule.describe ? rule.describe(req.body) : pick(req.body, rule.keep)],
  );
}

/** Records every successful Super Admin request that has a rule above (changes, plus viewing the payment keys). Never affects the request: a failure to log is only logged. */
export function superAdminActivityLogger(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const full = (req.originalUrl || "").split("?")[0];
    const i = full.indexOf("/super-admin");
    if (i < 0) return;
    const path = full.slice(i + "/super-admin".length).replace(/\/+$/, "");
    for (const rule of RULES) {
      if (rule.method !== req.method) continue;
      const m = path.match(rule.re);
      if (m) {
        record(req, rule, m).catch((e) => logger.error("super admin activity log failed", { action: rule.action, message: e?.message }));
        return;
      }
    }
  });
  next();
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface OwnerActivityFilters { entityTypes?: string[]; from?: string; to?: string; search?: string; page: number; limit: number }

const exists = async (name: string) => !!(await pool.query(`SELECT to_regclass($1) AS t`, [`public.${name}`])).rows[0]?.t;

export const ownerActivity = {
  /** The owner's own activity, newest first. owner = null when no such account exists (the page then says so). */
  async feed(f: OwnerActivityFilters) {
    const { rows: o } = await pool.query(
      `SELECT id, email, TRIM(CONCAT_WS(' ', first_name, last_name)) AS name FROM users WHERE lower(email) = $1 LIMIT 1`,
      [SUPER_ADMIN_OWNER_EMAIL],
    );
    const owner = o[0] ? { id: o[0].id as string, email: o[0].email as string, name: (o[0].name as string) || (o[0].email as string) } : null;
    if (!owner) return { items: [], total: 0, owner: { id: null, email: SUPER_ADMIN_OWNER_EMAIL, name: SUPER_ADMIN_OWNER_EMAIL, found: false } };

    const [hasLog, hasDeleted, hasCleanup, hasAudit] = await Promise.all([
      exists("super_admin_activity_log"), exists("deleted_account_log"), exists("salon_cleanup_log"), exists("client_activity_audit_logs"),
    ]);
    const parts: string[] = [];
    if (hasLog) parts.push(
      `SELECT l.id::text AS id, l.action, COALESCE(l.entity_type, 'other') AS entity_type, l.entity_id::text AS entity_id, l.entity_label AS subject,
              NULL::text AS salon_id, NULL::text AS salon_name,
              CASE WHEN l.actor_id = $1 THEN l.details ELSE COALESCE(l.details, '{}'::jsonb) || jsonb_build_object('by', l.actor_email) END AS details,
              l.created_at AS at
         FROM super_admin_activity_log l WHERE l.actor_id = $1 OR l.entity_type = 'payment_gateway'`);   // every Super Admin's use of the payment keys is shown
    if (hasDeleted) parts.push(
      `SELECT d.id::text, CASE WHEN d.account_type = 'salon' THEN 'salon_deleted' ELSE 'account_deleted' END, d.account_type, d.account_id::text,
              COALESCE(NULLIF(d.account_name, ''), d.account_email), NULL::text, NULL::text,
              jsonb_strip_nulls(jsonb_build_object('email', d.account_email, 'role', d.account_role, 'reason', d.reason)), d.created_at
         FROM deleted_account_log d WHERE d.deleted_by = $1`);
    if (hasCleanup) parts.push(
      `SELECT c.id::text, 'salon_data_cleared', 'salon', c.salon_id::text, c.salon_name, c.salon_id::text, c.salon_name,
              jsonb_strip_nulls(jsonb_build_object('reason', c.reason)), c.created_at
         FROM salon_cleanup_log c WHERE c.cleared_by = $1`);
    if (hasAudit) parts.push(
      `SELECT a.id::text, a.action, a.entity_type, a.entity_id::text,
              CASE a.entity_type
                WHEN 'meeting'  THEN (SELECT title FROM client_meetings WHERE id = a.entity_id)
                WHEN 'task'     THEN (SELECT title FROM client_followup_tasks WHERE id = a.entity_id)
                WHEN 'activity' THEN (SELECT LEFT(description, 80) FROM client_activity_logs WHERE id = a.entity_id)
                WHEN 'training' THEN (SELECT mo.name FROM client_training_progress p JOIN client_training_modules mo ON mo.id = p.module_id WHERE p.id = a.entity_id)
              END,
              a.salon_id::text, COALESCE(s.business_name, s.slug),
              CASE WHEN a.previous_values IS NOT NULL AND a.new_values IS NOT NULL THEN jsonb_build_object('previous', a.previous_values, 'new', a.new_values) END,
              a.changed_at
         FROM client_activity_audit_logs a LEFT JOIN salons s ON s.id = a.salon_id WHERE a.changed_by = $1`);
    if (!parts.length) return { items: [], total: 0, owner: { ...owner, found: true } };

    const params: any[] = [owner.id];
    const where: string[] = [];
    const add = (sql: (i: number) => string, v: any) => { params.push(v); where.push(sql(params.length)); };
    if (f.entityTypes?.length) add((i) => `e.entity_type = ANY($${i}::text[])`, f.entityTypes);
    if (f.from) add((i) => `e.at >= $${i}::date`, f.from);
    if (f.to) add((i) => `e.at < ($${i}::date + 1)`, f.to);
    if (f.search) add((i) => `(COALESCE(e.subject, '') ILIKE $${i} OR COALESCE(e.salon_name, '') ILIKE $${i} OR REPLACE(e.action, '_', ' ') ILIKE $${i})`, `%${f.search}%`);
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const base = `FROM (${parts.join(" UNION ALL ")}) AS e(id, action, entity_type, entity_id, subject, salon_id, salon_name, details, at) ${w}`;
    const countParams = [...params];
    params.push(f.limit, (f.page - 1) * f.limit);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(`SELECT e.* ${base} ORDER BY e.at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*)::int AS n ${base}`, countParams),
    ]);
    return { items: rows, total: c[0].n as number, owner: { ...owner, found: true } };
  },
};
