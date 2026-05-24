import { configRepository } from '../config/config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { WAAnalyticsStats, AnalyticsQuery, DailySpend } from './analytics.types'

// ── Meta per-message rates in INR — India billing (May 2026) ─────────────────
// Source: Meta WhatsApp Manager → Message pricing
// Marketing: ₹0.88, Utility: ₹0.125, Authentication: ₹0.125, Service: Free
const PRICING_INR: Record<string, number> = {
  marketing:      0.88,
  utility:        0.125,
  authentication: 0.125,
  service:        0.000,
}

function toDate(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0]
}

function emptyDay(date: string): DailySpend {
  return {
    date,
    marketing:          0,
    utility:            0,
    authentication:     0,
    service:            0,
    totalMessages:      0,
    totalConversations: 0,
    estimatedCost:      0,
  }
}

export const analyticsService = {

  async getAnalytics(salonId: string, query: AnalyticsQuery): Promise<WAAnalyticsStats> {
    const config = await configRepository.findBySalonId(salonId)

    if (!config) throw Object.assign(
      new Error('WhatsApp is not configured for this salon. Go to WA Config and save your settings.'),
      { status: 400 }
    )
    if (!config.waba_id) throw Object.assign(
      new Error('WABA ID is missing from your WhatsApp config. Go to WA Config, add your WABA ID and save.'),
      { status: 400 }
    )
    if (!config.access_token) throw Object.assign(
      new Error('Access token is missing from your WhatsApp config. Go to WA Config and save your token.'),
      { status: 400 }
    )

    const startTs     = Math.floor(new Date(query.start).getTime() / 1000)
    const endTs       = Math.floor(new Date(query.end).getTime()   / 1000)
    const granularity = query.granularity ?? 'DAILY'

    const byDate: Record<string, DailySpend> = {}
    let usedPricingAnalytics = false

    // ── Step 1: Try new pricing_analytics (PMP — per message, July 2025+) ──
    try {
      const raw = await whatsappMetaApi.fetchPricingAnalytics({
        wabaId:      config.waba_id,
        accessToken: config.access_token,
        start:       startTs,
        end:         endTs,
        granularity,
      })

      const dataPoints: any[] = raw?.pricing_analytics?.data?.[0]?.data_points ?? []

      if (dataPoints.length > 0) {
        usedPricingAnalytics = true

        for (const point of dataPoints) {
          const date = toDate(point.start)

          // Meta returns uppercase e.g. "MARKETING" — lowercase for mapping
          const category = (
            point.pricing_category      ??
            point.conversation_category ??
            'service'
          ).toLowerCase()

          // ← FIXED: Meta uses "volume" field not "message_count"
          const count = point.volume ?? point.message_count ?? point.conversation ?? 0

          // use Meta's actual cost if provided (in INR for India accounts)
          const cost = point.cost != null && point.cost > 0
            ? Number(point.cost)
            : count * (PRICING_INR[category] ?? 0)

          if (!byDate[date]) byDate[date] = emptyDay(date)

          const validCat = ['marketing', 'utility', 'authentication', 'service'].includes(category)
            ? category as keyof typeof PRICING_INR
            : 'service'

          ;(byDate[date] as any)[validCat] += count
          byDate[date].totalMessages       += count
          byDate[date].totalConversations  += count
          byDate[date].estimatedCost       += cost
        }
      }
    } catch (err: any) {
      console.warn('[pricing_analytics failed, falling back]', err?.response?.data ?? err?.message)
    }

    // ── Step 2: Fallback to old conversation_analytics ────────────────────
    if (!usedPricingAnalytics) {
      try {
        const raw = await whatsappMetaApi.fetchWabaAnalytics({
          wabaId:      config.waba_id,
          accessToken: config.access_token,
          start:       startTs,
          end:         endTs,
          granularity,
        })

        const dataPoints: any[] = raw?.conversation_analytics?.data?.[0]?.data_points ?? []

        for (const point of dataPoints) {
          const date  = toDate(point.start)
          const type  = (point.conversation_type ?? 'service').toLowerCase()
          const count = point.volume ?? point.conversation ?? 0

          if (!byDate[date]) byDate[date] = emptyDay(date)

          const validType = ['marketing', 'utility', 'authentication', 'service'].includes(type)
            ? type as keyof typeof PRICING_INR
            : 'service'

          ;(byDate[date] as any)[validType] += count
          byDate[date].totalConversations   += count
          byDate[date].totalMessages        += count
          byDate[date].estimatedCost        += count * PRICING_INR[validType]
        }
      } catch (metaErr: any) {
        console.error('[Meta analytics ERROR]', JSON.stringify({
          status:  metaErr?.response?.status,
          data:    metaErr?.response?.data,
          message: metaErr?.message,
          wabaId:  config.waba_id,
        }, null, 2))
        const metaMsg = metaErr?.response?.data?.error?.message ?? metaErr?.message ?? 'Meta API error'
        throw Object.assign(new Error('Meta API: ' + metaMsg), { status: 502 })
      }
    }

    const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))

    const byCategory     = { marketing: 0, utility: 0, authentication: 0, service: 0 }
    const byCategoryCost = { marketing: 0, utility: 0, authentication: 0, service: 0 }
    let totalConversations = 0
    let totalMessages      = 0
    let totalEstimatedCost = 0

    for (const d of daily) {
      for (const cat of ['marketing', 'utility', 'authentication', 'service'] as const) {
        byCategory[cat]     += (d as any)[cat]
        byCategoryCost[cat] += (d as any)[cat] * PRICING_INR[cat]
      }
      totalConversations += d.totalConversations
      totalMessages      += d.totalMessages
      totalEstimatedCost += d.estimatedCost
    }

    return {
      totalConversations,
      totalMessages,
      totalEstimatedCost:  Math.round(totalEstimatedCost * 100) / 100,
      pricingModel:        usedPricingAnalytics ? 'PMP' : 'CBP',
      currency:            'INR',
      byCategory,
      byCategoryCost: {
        marketing:      Math.round(byCategoryCost.marketing      * 100) / 100,
        utility:        Math.round(byCategoryCost.utility        * 100) / 100,
        authentication: Math.round(byCategoryCost.authentication * 100) / 100,
        service:        0,
      },
      daily,
      periodStart: query.start,
      periodEnd:   query.end,
    }
  },
}