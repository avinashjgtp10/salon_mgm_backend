// Meta's own numbers for a salon's WhatsApp account: what it was actually billed
// (pricing_analytics) and how each template performed (template_analytics,
// including button clicks). Read-only; nothing here writes anything.
//
// Meta limits: 90 days of history, 10 template ids per template_analytics call.
import axios from 'axios'
import pool from '../../../../config/database'
import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from '../config/config.repository'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v22.0'
const http = axios.create({ timeout: 40_000 })

const num = (v: unknown) => Number(v) || 0
const metaError = (e: any) => e?.response?.data?.error?.message ?? e?.message ?? 'Meta request failed'

export const insightsService = {

  async getInsights(salonId: string, daysRaw: number) {
    const days = Math.min(Math.max(Math.round(daysRaw) || 30, 1), 90)
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp is not connected for this salon', 'WA_NOT_CONFIGURED')

    const headers = { Authorization: `Bearer ${config.access_token}` }
    const base    = `${WA_BASE_URL}/${WA_API_VERSION}/${config.waba_id}`
    const end     = Math.floor(Date.now() / 1000)
    const start   = end - days * 86400
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
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10)
      try {
        const r = await http.get(`${base}/template_analytics`, {
          headers,
          params: {
            start, end, granularity: 'DAILY',
            metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED']),
            template_ids: JSON.stringify(chunk),
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
      } catch (e: any) {
        errors.push(`Templates: ${metaError(e)}`)
        break
      }
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
