// Meta's own numbers for a salon's WhatsApp account: what it was actually billed
// (pricing_analytics) and how each template performed (template_analytics,
// including button clicks). Read-only; nothing here writes anything.
//
// Meta limits: 90 days of history, 10 template ids per template_analytics call.
import axios from 'axios'
import pool from '../../../../config/database'
import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from '../config/config.repository'
import logger from '../../../../config/logger'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v22.0'
const http = axios.create({ timeout: 40_000 })

const num = (v: unknown) => Number(v) || 0
// What Meta said, in full, for the logs (code / subcode / fbtrace_id are what
// Meta support asks for).
const metaDetail = (e: any) => {
  const err = e?.response?.data?.error ?? {}
  return {
    message: err.error_user_msg ?? err.message ?? e?.message ?? 'Meta request failed',
    code: err.code as number | undefined,
    subcode: err.error_subcode as number | undefined,
    trace: err.fbtrace_id as string | undefined,
    status: e?.response?.status as number | undefined,
  }
}

// A message the salon can act on. Meta's own text for a generic failure is
// literally "An unknown error occurred.", which says nothing, so the common
// cases are translated; anything else keeps Meta's wording.
const metaError = (e: any): string => {
  const d = metaDetail(e)
  if (d.code === 190 || d.status === 401) return 'The WhatsApp connection has expired or been revoked. Reconnect WhatsApp in Marketing settings.'
  if (d.code === 10 || d.code === 200 || d.code === 299) return 'The connected WhatsApp account has not granted the permission needed to read insights (whatsapp_business_management). Reconnect it and accept all permissions.'
  if ([4, 17, 32, 613, 80008].includes(d.code as number) || d.status === 429) return 'Meta is rate-limiting insight requests right now. Try again in a few minutes.'
  if (d.code === 1 || d.code === 2 || /unknown error/i.test(d.message)) return 'Meta could not return this data right now (it reported an unknown error). This is usually temporary; try again shortly.'
  if (e?.code === 'ECONNABORTED') return 'Meta took too long to respond. Try again, or pick a shorter period.'
  return d.message
}
// Errors where every further call would fail the same way, so stop asking.
const isFatal = (e: any) => {
  const d = metaDetail(e)
  return d.code === 190 || d.status === 401 || [4, 17, 32, 613, 80008].includes(d.code as number) || d.status === 429
}

export const insightsService = {

  async getInsights(salonId: string, daysRaw: number) {
    const days = Math.min(Math.max(Math.round(daysRaw) || 30, 1), 90)
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp is not connected for this salon', 'WA_NOT_CONFIGURED')

    const headers = { Authorization: `Bearer ${config.access_token}` }
    const base    = `${WA_BASE_URL}/${WA_API_VERSION}/${config.waba_id}`
    const end     = Math.floor(Date.now() / 1000)
    // Meta serves at most 90 days back and rejects a start right on that edge,
    // so keep a day of margin and begin at midnight UTC (DAILY granularity).
    const start   = Math.floor((end - Math.min(days, 89) * 86400) / 86400) * 86400
    const errors: string[] = []

    // ── Currency of the account (prices come back as bare numbers) ───────────
    let currency = 'INR'
    try {
      const r = await http.get(base, { headers, params: { fields: 'currency' } })
      if (r.data?.currency) currency = String(r.data.currency)
    } catch { /* keep the default */ }

    // ── What Meta billed ──────────────────────────────────────────────────────
    const byCategory: Record<string, { volume: number; cost: number; freeVolume: number }> = {}
    const dailyMap: Record<string, { date: string; cost: number; volume: number }> = {}
    let totalCost = 0, billableVolume = 0, freeVolume = 0
    try {
      const r = await http.get(`${base}/pricing_analytics`, {
        headers,
        params: { start, end, granularity: 'DAILY', dimensions: JSON.stringify(['PRICING_CATEGORY', 'PRICING_TYPE']) },
      })
      for (const block of r.data?.data ?? []) {
        for (const p of block.data_points ?? []) {
          const cat    = String(p.pricing_category ?? 'OTHER')
          const volume = num(p.volume), cost = num(p.cost)
          const free   = String(p.pricing_type ?? '').startsWith('FREE') || cost === 0
          byCategory[cat] ??= { volume: 0, cost: 0, freeVolume: 0 }
          byCategory[cat].volume += volume
          byCategory[cat].cost   += cost
          if (free) { byCategory[cat].freeVolume += volume; freeVolume += volume } else { billableVolume += volume }
          totalCost += cost
          const date = new Date(num(p.start) * 1000).toISOString().slice(0, 10)
          dailyMap[date] ??= { date, cost: 0, volume: 0 }
          dailyMap[date].cost   += cost
          dailyMap[date].volume += volume
        }
      }
    } catch (e: any) {
      logger.warn('[wa-insights] pricing_analytics failed', { salonId, ...metaDetail(e) })
      errors.push(`Spend: ${metaError(e)}`)
    }

    // ── How each template performed ───────────────────────────────────────────
    const { rows: tpls } = await pool.query(
      `SELECT name, meta_template_id FROM wa_templates
       WHERE salon_id = $1 AND status = 'APPROVED' AND meta_template_id IS NOT NULL`,
      [salonId]
    )
    const nameOf = new Map<string, string>(tpls.map((t: any) => [String(t.meta_template_id), t.name]))
    const agg = new Map<string, { template_id: string; name: string; sent: number; delivered: number; read: number; clicked: number; clicks: Record<string, number> }>()
    const ids = Array.from(nameOf.keys())
    const ALL_METRICS = ['SENT', 'DELIVERED', 'READ', 'CLICKED']
    const fetchTemplates = async (batch: string[], metrics: string[] = ALL_METRICS) => {
      const r = await http.get(`${base}/template_analytics`, {
        headers,
        params: {
          start, end, granularity: 'DAILY',
          metric_types: JSON.stringify(metrics),
          template_ids: JSON.stringify(batch),
        },
      })
      for (const block of r.data?.data ?? []) {
        for (const p of block.data_points ?? []) {
          const id = String(p.template_id)
          const row = agg.get(id) ?? { template_id: id, name: nameOf.get(id) ?? id, sent: 0, delivered: 0, read: 0, clicked: 0, clicks: {} }
          row.sent += num(p.sent); row.delivered += num(p.delivered); row.read += num(p.read)
          for (const c of p.clicked ?? []) {
            const n = num(c.count); row.clicked += n
            const label = String(c.button_content ?? c.type ?? 'Button')
            row.clicks[label] = (row.clicks[label] ?? 0) + n
          }
          agg.set(id, row)
        }
      }
    }

    // One template Meta cannot report on (deleted on Meta's side, wrong WABA, too
    // new) used to fail its whole batch of 10 with a generic error, and the loop
    // then gave up on every remaining batch. A failed batch is now retried one
    // template at a time, so only the offending template is lost and the error
    // names it.
    // CLICKED is the one metric Meta is picky about (it only exists for templates
    // with buttons). If a call fails with it, ask again for sent/delivered/read
    // only: the counts still show, just without button clicks.
    const withoutClicks = ALL_METRICS.filter((m) => m !== 'CLICKED')
    const fetchLenient = async (batch: string[]) => {
      try {
        await fetchTemplates(batch)
      } catch (e: any) {
        if (isFatal(e)) throw e
        await fetchTemplates(batch, withoutClicks)
        logger.warn('[wa-insights] template_analytics worked only without CLICKED', { salonId, ids: batch, ...metaDetail(e) })
      }
    }
    const skipped: string[] = []
    let lastFailure: any = null
    outer:
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10)
      try {
        await fetchLenient(batch)
      } catch (e: any) {
        logger.warn('[wa-insights] template_analytics batch failed', { salonId, ids: batch, ...metaDetail(e) })
        if (isFatal(e)) { errors.push(`Templates: ${metaError(e)}`); break }
        lastFailure = e
        for (const id of batch) {
          try {
            await fetchLenient([id])
          } catch (e2: any) {
            logger.warn('[wa-insights] template_analytics failed for one template', { salonId, id, ...metaDetail(e2) })
            if (isFatal(e2)) { errors.push(`Templates: ${metaError(e2)}`); break outer }
            lastFailure = e2
            skipped.push(nameOf.get(id) ?? id)
          }
        }
      }
    }
    if (skipped.length > 0) {
      const shown = skipped.slice(0, 5).join(', ') + (skipped.length > 5 ? ` and ${skipped.length - 5} more` : '')
      errors.push(`Templates: Meta could not return insights for ${skipped.length} template${skipped.length === 1 ? '' : 's'} (${shown}). ${metaError(lastFailure)}`)
    }
    const templates = Array.from(agg.values())
      .filter((t) => t.sent > 0)
      .sort((a, b) => b.sent - a.sent)

    return {
      days, currency, start, end,
      totals: { cost: totalCost, billableVolume, freeVolume, volume: billableVolume + freeVolume },
      byCategory: Object.entries(byCategory).map(([category, v]) => ({ category, ...v })).sort((a, b) => b.cost - a.cost),
      daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      templates,
      errors,
    }
  },
}
