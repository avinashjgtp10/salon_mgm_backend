import pool from '../../../../config/database'
import {
  WADashboardStats,
  WARecentCampaign,
  WATopCampaign,
  WATopTemplate,
  WAEngagedContact,
} from './dashboard.types'

export const dashboardRepository = {

  async getStats(salonId: string): Promise<WADashboardStats> {

    // ── Single CTE query replaces 4 sequential round-trips ─────────────────
    const { rows: [combined] } = await pool.query(`
      WITH
        contacts AS (
          SELECT cc.status, cc.phone, cc.created_at
          FROM wa_campaign_contacts cc
          JOIN wa_campaigns c ON c.id = cc.campaign_id
          WHERE c.salon_id = $1
        ),
        kpi AS (
          SELECT
            COUNT(*)                                                           AS total_sent,
            COUNT(CASE WHEN status IN ('DELIVERED','READ') THEN 1 END)         AS total_delivered,
            COUNT(CASE WHEN status = 'READ'               THEN 1 END)          AS total_read,
            COUNT(CASE WHEN status = 'FAILED'             THEN 1 END)          AS total_failed,
            COUNT(CASE WHEN status = 'BLOCKED'            THEN 1 END)          AS total_blocked,
            COUNT(DISTINCT phone)                                               AS total_contacts
          FROM contacts
        ),
        camps AS (
          SELECT
            COUNT(DISTINCT id)                                                  AS total_campaigns,
            COUNT(DISTINCT CASE WHEN status IN ('SENDING','RUNNING') THEN id END) AS active_campaigns,
            COUNT(DISTINCT CASE WHEN status = 'COMPLETED' THEN id END)          AS completed_campaigns
          FROM wa_campaigns WHERE salon_id = $1
        ),
        daily AS (
          SELECT json_agg(d) AS daily_volume FROM (
            SELECT DATE(created_at)::text AS date, COUNT(*)::int AS count
            FROM contacts
            WHERE created_at >= NOW() - INTERVAL '7 days'
              AND status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED')
            GROUP BY DATE(created_at)
            ORDER BY DATE(created_at) ASC
          ) d
        )
      SELECT
        row_to_json(kpi)  AS kpi,
        row_to_json(camps) AS camps,
        (SELECT daily_volume FROM daily) AS daily_volume
      FROM kpi, camps
    `, [salonId])

    const k  = combined?.kpi   || {}
    const c  = combined?.camps || {}
    const dv = combined?.daily_volume || []

    const totalSent      = parseInt(k.total_sent)      || 0
    const totalDelivered = parseInt(k.total_delivered) || 0
    const totalRead      = parseInt(k.total_read)      || 0
    const totalFailed    = parseInt(k.total_failed)    || 0
    const totalBlocked   = parseInt(k.total_blocked)   || 0

    // ── 4 queries in parallel ─────────────────────────────────────────────
    const [recentCampaigns, topCampaigns, topTemplates, engagedContacts] = await Promise.all([
      this.getRecentCampaigns(salonId),
      this.getTopCampaigns(salonId),
      this.getTopTemplates(salonId),
      this.getEngagedContacts(salonId),
    ])

    return {
      totalCampaigns:     parseInt(c.total_campaigns)     || 0,
      activeCampaigns:    parseInt(c.active_campaigns)    || 0,
      completedCampaigns: parseInt(c.completed_campaigns) || 0,
      totalMessagesSent:  totalSent,
      totalSent,
      totalDelivered,
      totalRead,
      totalFailed,
      totalBlocked,
      totalContacts:      parseInt(k.total_contacts)      || 0,
      deliveryRate:       totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
      readRate:           totalSent > 0 ? Math.round((totalRead      / totalSent) * 100) : 0,
      dailyVolume:        dv,
      recentCampaigns,
      topCampaigns,
      topTemplates,
      engagedContacts,
    }
  },

  async getRecentCampaigns(salonId: string): Promise<WARecentCampaign[]> {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.status, c.created_at, c.completed_at, c.total_contacts,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS sent_count,
        COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END) AS delivered_count,
        COUNT(CASE WHEN cc.status = 'READ'                THEN 1 END) AS read_count,
        COUNT(CASE WHEN cc.status = 'FAILED'              THEN 1 END) AS failed_count,
        COUNT(CASE WHEN cc.status = 'BLOCKED'             THEN 1 END) AS blocked_count
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      WHERE c.salon_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 5
    `, [salonId])
    return rows
  },

  async getTopCampaigns(salonId: string): Promise<WATopCampaign[]> {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.status, c.created_at, c.total_contacts,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS sent_count,
        COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END) AS delivered_count,
        COUNT(CASE WHEN cc.status = 'READ'                THEN 1 END) AS read_count,
        COUNT(CASE WHEN cc.status = 'FAILED'              THEN 1 END) AS failed_count,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END)::numeric /
               COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS delivery_rate,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
               COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS read_rate
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      WHERE c.salon_id = $1
      GROUP BY c.id
      HAVING COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
      ORDER BY read_rate DESC, delivered_count DESC
      LIMIT 5
    `, [salonId])
    return rows
  },

  async getTopTemplates(salonId: string): Promise<WATopTemplate[]> {
    const { rows } = await pool.query(`
      SELECT
        c.template_id,
        COALESCE(t.name, c.template_id::text) AS template_name,
        COUNT(DISTINCT c.id)                   AS times_used,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS total_sent,
        COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END) AS total_delivered,
        COUNT(CASE WHEN cc.status = 'READ'                THEN 1 END) AS total_read,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
               COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS avg_read_rate
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      LEFT JOIN wa_templates t ON t.id::text = c.template_id::text AND t.salon_id = c.salon_id
      WHERE c.salon_id = $1 AND c.template_id IS NOT NULL
      GROUP BY c.template_id, t.name
      HAVING COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
      ORDER BY avg_read_rate DESC, total_sent DESC
      LIMIT 5
    `, [salonId])
    return rows
  },

  async getEngagedContacts(salonId: string): Promise<WAEngagedContact[]> {
    const { rows } = await pool.query(`
      SELECT
        cc.phone,
        MAX(cc.name)                                                                            AS name,
        COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)                                         AS campaigns_read,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS total_received,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
               COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS read_rate,
        MAX(CASE WHEN cc.status = 'READ' THEN cc.updated_at END) AS last_read_at
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id = $1
      GROUP BY cc.phone
      HAVING COUNT(CASE WHEN cc.status = 'READ' THEN 1 END) > 0
      ORDER BY campaigns_read DESC, read_rate DESC
      LIMIT 10
    `, [salonId])
    return rows
  },
}