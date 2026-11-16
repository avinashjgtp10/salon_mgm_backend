import pool from '../../config/database'

// Super Admin "Marketing Logs": every message the platform sent to clients, across ALL salons, from the three places they are
// recorded — automation messages (wa_automation_logs), campaign recipients (wa_campaign_contacts) and SMS / Email
// (notification_channel_logs). Nothing is written here; this only reads what the existing senders already log.

export type LogSource = 'automation' | 'campaign' | 'sms' | 'email'
export const ALL_SOURCES: LogSource[] = ['automation', 'campaign', 'sms', 'email']
export const LOG_STATUSES = ['SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] as const
export const LOG_ORIGINS = ['meta', 'platform', 'provider'] as const

export interface LogFilters {
  from: string          // YYYY-MM-DD, inclusive
  to: string            // YYYY-MM-DD, inclusive
  salonId?: string | null
  sources?: LogSource[]
  statuses?: string[]
  /** Who a failure is down to: 'meta' (WhatsApp/Meta refused it), 'platform' (our side), 'provider' (SMS/Email gateway). */
  origins?: string[]
  search?: string
}

// Messages to the salon owner (not a client) are not marketing.
const OWNER_EVENTS = `'cash_counter_opened','cash_counter_closed','cash_counter_opened_updated','cash_counter_closed_updated'`
const UNDEFINED_TABLE = '42P01'

// Who a failed / skipped message is down to, worked out from what we hold:
//   meta     - the error carries a Meta/WhatsApp numeric code (131026, 131049, 132001 ...): Meta or the recipient's WhatsApp refused it
//   provider - an SMS / Email the gateway or mail server rejected
//   platform - any other failure or skip: our own checks (template not approved, WhatsApp not connected, client opted out,
//              recently messaged, missing media ...) or a network / timeout error before Meta answered
// Sent, delivered and read messages have no failure origin.
// Meta codes run from 1 digit (1, 4, 10) to 7 (2388xxx template subcodes); our own codes are words (MISSING_MEDIA_ID, unknown).
const NUMERIC_CODE = '^[0-9]{1,7}$'
const ORIGIN_SQL = `CASE
    WHEN l.status NOT IN ('FAILED','SKIPPED') THEN NULL
    WHEN l.error_code ~ '${NUMERIC_CODE}' THEN 'meta'
    WHEN l.source IN ('sms','email') AND l.status = 'FAILED' THEN 'provider'
    ELSE 'platform'
  END`

// $1 = from, $2 = to, $3 = salon id (or null for every salon). The date window and salon are applied inside every branch, so the
// UNION never reads more than the requested slice of each table.
function logsCte(sources: LogSource[], withChannels: boolean): string {
  const branches: string[] = []
  if (sources.includes('automation')) {
    // Meta's code is in meta_response (send-time answer or webhook failure), or in the "(Meta code N)" text the webhook writes.
    branches.push(`
      SELECT 'automation'::text AS source, l.salon_id, l.phone_number::text AS recipient, l.event_type::text AS label,
             l.status::text AS status, l.sent_at, l.delivered_at, l.read_at, l.failure_reason::text AS failure_reason,
             COALESCE(l.meta_response::jsonb->'error'->>'code', l.meta_response::jsonb->>'code',
                      substring(l.failure_reason::text from 'Meta code ([0-9]+)')) AS error_code,
             COALESCE(l.sent_at, l.created_at) AS ts
      FROM wa_automation_logs l
      WHERE l.status <> 'QUEUED'
        AND l.event_type NOT IN (${OWNER_EVENTS})
        AND COALESCE(l.sent_at, l.created_at) >= $1::date
        AND COALESCE(l.sent_at, l.created_at) <  ($2::date + interval '1 day')
        AND ($3::uuid IS NULL OR l.salon_id = $3::uuid)`)
  }
  if (sources.includes('campaign')) {
    branches.push(`
      SELECT 'campaign'::text, c.salon_id, cc.phone::text, c.name::text,
             CASE WHEN cc.status = 'BLOCKED' THEN 'FAILED' ELSE cc.status::text END,
             cc.sent_at, cc.delivered_at, cc.read_at,
             COALESCE(cc.error_message::text, CASE WHEN cc.status = 'BLOCKED' THEN 'Blocked' END),
             cc.error_code::text,
             COALESCE(cc.sent_at, cc.created_at)
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE cc.status <> 'PENDING'
        AND COALESCE(cc.sent_at, cc.created_at) >= $1::date
        AND COALESCE(cc.sent_at, cc.created_at) <  ($2::date + interval '1 day')
        AND ($3::uuid IS NULL OR c.salon_id = $3::uuid)`)
  }
  if (withChannels && (sources.includes('sms') || sources.includes('email'))) {
    const channels = [sources.includes('sms') ? `'SMS'` : null, sources.includes('email') ? `'EMAIL'` : null].filter(Boolean).join(',')
    branches.push(`
      SELECT LOWER(n.channel)::text, n.salon_id, n.recipient::text, n.event_type::text, n.status::text,
             NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, n.failure_reason::text, NULL::text, n.created_at
      FROM notification_channel_logs n
      WHERE n.status <> 'PENDING'
        AND n.channel IN (${channels})
        AND n.event_type NOT IN (${OWNER_EVENTS})
        AND n.created_at >= $1::date
        AND n.created_at <  ($2::date + interval '1 day')
        AND ($3::uuid IS NULL OR n.salon_id = $3::uuid)`)
  }
  if (branches.length === 0) {
    // Nothing to read (e.g. only SMS/Email asked for but that table is missing): an empty set with the right shape.
    branches.push(`SELECT NULL::text AS source, NULL::uuid AS salon_id, NULL::text AS recipient, NULL::text AS label, NULL::text AS status,
                          NULL::timestamptz AS sent_at, NULL::timestamptz AS delivered_at, NULL::timestamptz AS read_at,
                          NULL::text AS failure_reason, NULL::text AS error_code, NULL::timestamptz AS ts WHERE FALSE`)
  }
  return `WITH logs AS (${branches.join('\n      UNION ALL\n')})`
}

// SMS/Email log table is optional (created by its own migration) — if it is missing, run again without it.
async function run<T>(filters: LogFilters, build: (cte: string) => { sql: string; values: any[] }): Promise<T[]> {
  const sources = filters.sources?.length ? filters.sources : ALL_SOURCES
  for (const withChannels of [true, false]) {
    const { sql, values } = build(logsCte(sources, withChannels))
    try {
      const { rows } = await pool.query(sql, values)
      return rows as T[]
    } catch (err: any) {
      if (err?.code === UNDEFINED_TABLE && withChannels) continue
      throw err
    }
  }
  return []
}

// Outer filters. $4 = statuses or null, $5 = search text or null, $6 = failure origins or null.
const OUTER_WHERE = `
  ($4::text[] IS NULL OR l.status = ANY($4::text[]))
  AND ($5::text IS NULL OR l.recipient ILIKE $5 OR COALESCE(s.business_name, s.slug, '') ILIKE $5 OR l.label ILIKE $5)
  AND ($6::text[] IS NULL OR (${ORIGIN_SQL}) = ANY($6::text[]))`

const baseValues = (f: LogFilters) => [
  f.from,
  f.to,
  f.salonId ?? null,
  f.statuses?.length ? f.statuses : null,
  f.search?.trim() ? `%${f.search.trim()}%` : null,
  f.origins?.length ? f.origins : null,
]

export const marketingLogsRepository = {
  async summary(filters: LogFilters): Promise<{
    totals: { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number }
    bySource: { source: string; total: number; sent: number; delivered: number; read: number; failed: number }[]
    bySalon: any[]
  }> {
    const counts = `
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE l.status IN ('SENT','DELIVERED','READ'))::int AS sent,
      COUNT(*) FILTER (WHERE l.status IN ('DELIVERED','READ'))::int AS delivered,
      COUNT(*) FILTER (WHERE l.status = 'READ')::int AS read,
      COUNT(*) FILTER (WHERE l.status = 'FAILED')::int AS failed`
    const values = baseValues(filters)

    const totals = await run<any>(filters, (cte) => ({
      sql: `${cte}
            SELECT ${counts}, COUNT(*) FILTER (WHERE l.status = 'SKIPPED')::int AS skipped
            FROM logs l LEFT JOIN salons s ON s.id = l.salon_id WHERE ${OUTER_WHERE}`,
      values,
    }))
    const bySource = await run<any>(filters, (cte) => ({
      sql: `${cte}
            SELECT l.source, ${counts}
            FROM logs l LEFT JOIN salons s ON s.id = l.salon_id WHERE ${OUTER_WHERE}
            GROUP BY l.source ORDER BY total DESC`,
      values,
    }))
    const bySalon = await run<any>(filters, (cte) => ({
      sql: `${cte}
            SELECT l.salon_id, COALESCE(s.business_name, s.slug, 'Unknown') AS salon_name, ${counts},
                   COUNT(*) FILTER (WHERE l.source = 'automation')::int AS automation,
                   COUNT(*) FILTER (WHERE l.source = 'campaign')::int   AS campaign,
                   COUNT(*) FILTER (WHERE l.source = 'sms')::int        AS sms,
                   COUNT(*) FILTER (WHERE l.source = 'email')::int      AS email
            FROM logs l LEFT JOIN salons s ON s.id = l.salon_id WHERE ${OUTER_WHERE}
            GROUP BY l.salon_id, s.business_name, s.slug
            ORDER BY total DESC LIMIT 200`,
      values,
    }))
    return {
      totals: totals[0] ?? { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 },
      bySource,
      bySalon,
    }
  },

  async list(filters: LogFilters, page: number, limit: number): Promise<{ data: any[]; total: number }> {
    const values = baseValues(filters)
    const count = await run<{ n: number }>(filters, (cte) => ({
      sql: `${cte} SELECT COUNT(*)::int AS n FROM logs l LEFT JOIN salons s ON s.id = l.salon_id WHERE ${OUTER_WHERE}`,
      values,
    }))
    const data = await run<any>(filters, (cte) => ({
      sql: `${cte}
            SELECT l.source, l.salon_id, COALESCE(s.business_name, s.slug, 'Unknown') AS salon_name, l.recipient, l.label,
                   l.status, l.sent_at, l.delivered_at, l.read_at, l.failure_reason, l.error_code,
                   (${ORIGIN_SQL}) AS error_origin, l.ts
            FROM logs l LEFT JOIN salons s ON s.id = l.salon_id
            WHERE ${OUTER_WHERE}
            ORDER BY l.ts DESC
            LIMIT $7 OFFSET $8`,
      values: [...values, limit, (page - 1) * limit],
    }))
    return { data, total: count[0]?.n ?? 0 }
  },
}
