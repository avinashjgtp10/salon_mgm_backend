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

    // ── KPI totals from wa_campaign_contacts — source of truth ────────────
    // READ implies DELIVERED, so delivered count includes READ
    const { rows: [kpi] } = await pool.query(`
  SELECT
    COUNT(*)                                                           AS total_sent,
    COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END)     AS total_delivered,
    COUNT(CASE WHEN cc.status = 'READ'               THEN 1 END)      AS total_read,
    COUNT(CASE WHEN cc.status = 'FAILED'             THEN 1 END)      AS total_failed,
    COUNT(CASE WHEN cc.status = 'BLOCKED'            THEN 1 END)      AS total_blocked,
    COUNT(CASE WHEN cc.status = 'SENT'               THEN 1 END)      AS total_pending
  FROM wa_campaign_contacts cc
  JOIN wa_campaigns c ON c.id = cc.campaign_id
  WHERE c.salon_id = $1
`, [salonId])

    // ── Campaign counts ───────────────────────────────────────────────────
    const { rows: [campCounts] } = await pool.query(`
      SELECT
        COUNT(DISTINCT id)                                                     AS total_campaigns,
        COUNT(DISTINCT CASE WHEN status IN ('SENDING','RUNNING') THEN id END)  AS active_campaigns,
        COUNT(DISTINCT CASE WHEN status = 'COMPLETED'            THEN id END)  AS completed_campaigns
      FROM wa_campaigns
      WHERE salon_id = $1
    `, [salonId])

    // ── Total unique contacts ever messaged ───────────────────────────────
    const { rows: [contactCount] } = await pool.query(`
      SELECT COUNT(DISTINCT cc.phone) AS total_contacts
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id = $1
    `, [salonId])

    const totalSent      = parseInt(kpi.total_sent)      || 0
    const totalDelivered = parseInt(kpi.total_delivered) || 0
    const totalRead      = parseInt(kpi.total_read)      || 0
    const totalFailed    = parseInt(kpi.total_failed)    || 0
    const totalBlocked   = parseInt(kpi.total_blocked)   || 0
    

    // ── Daily volume ──────────────────────────────────────────────────────
    const { rows: dailyRows } = await pool.query(`
      SELECT
        DATE(cc.created_at)::text AS date,
        COUNT(*)::int             AS count
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id = $1
        AND cc.created_at >= NOW() - INTERVAL '7 days'
        AND cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED')
      GROUP BY DATE(cc.created_at)
      ORDER BY DATE(cc.created_at) ASC
    `, [salonId])

    const [recentCampaigns, topCampaigns, topTemplates, engagedContacts] = await Promise.all([
      this.getRecentCampaigns(salonId),
      this.getTopCampaigns(salonId),
      this.getTopTemplates(salonId),
      this.getEngagedContacts(salonId),
    ])

    return {
      totalCampaigns:     parseInt(campCounts.total_campaigns)     || 0,
      activeCampaigns:    parseInt(campCounts.active_campaigns)    || 0,
      completedCampaigns: parseInt(campCounts.completed_campaigns) || 0,
      totalMessagesSent:  totalSent,
      totalSent,
      totalDelivered,
      totalRead,
      totalFailed,
      totalBlocked,
      totalContacts:      parseInt(contactCount.total_contacts)    || 0,
      deliveryRate:       totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
      readRate:           totalSent > 0 ? Math.round((totalRead      / totalSent) * 100) : 0,
      dailyVolume:        dailyRows,
      recentCampaigns,
      topCampaigns,
      topTemplates,
      engagedContacts,
    }
  },

  async getRecentCampaigns(salonId: string): Promise<WARecentCampaign[]> {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.status, c.created_at, c.completed_at,
        c.total_contacts,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS sent_count,
        COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END) AS delivered_count,
        COUNT(CASE WHEN cc.status = 'READ'                THEN 1 END) AS read_count,
        COUNT(CASE WHEN cc.status = 'FAILED'              THEN 1 END) AS failed_count,
        COUNT(CASE WHEN cc.status = 'BLOCKED'             THEN 1 END) AS blocked_count
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      WHERE c.salon_id = $1
      GROUP BY c.id, c.name, c.status, c.created_at, c.completed_at, c.total_contacts
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
          THEN ROUND(
            COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END)::numeric /
            COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS delivery_rate,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(
            COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
            COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS read_rate
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      WHERE c.salon_id = $1
      GROUP BY c.id, c.name, c.status, c.created_at, c.total_contacts
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
        COALESCE(t.name, c.template_id::text)                                    AS template_name,
        COUNT(DISTINCT c.id)                                                      AS times_used,
        COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS total_sent,
        COUNT(CASE WHEN cc.status IN ('DELIVERED','READ') THEN 1 END)             AS total_delivered,
        COUNT(CASE WHEN cc.status = 'READ'                THEN 1 END)             AS total_read,
        CASE
          WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
          THEN ROUND(
            COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
            COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
          ELSE 0
        END AS avg_read_rate
      FROM wa_campaigns c
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      LEFT JOIN wa_templates t
        ON t.id::text = c.template_id::text
       AND t.salon_id = c.salon_id
      WHERE c.salon_id = $1
        AND c.template_id IS NOT NULL
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
      -- normalize phone: strip non-digits then add + prefix
      '+' || REGEXP_REPLACE(cc.phone, '[^0-9]', '', 'g') AS phone,
      -- pick the most recently used non-null name
      (ARRAY_REMOVE(ARRAY_AGG(cc.name ORDER BY cc.updated_at DESC), NULL))[1] AS name,
      COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)  AS campaigns_read,
      COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) AS total_received,
      CASE
        WHEN COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) > 0
        THEN ROUND(
          COUNT(CASE WHEN cc.status = 'READ' THEN 1 END)::numeric /
          COUNT(CASE WHEN cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED') THEN 1 END) * 100, 1)
        ELSE 0
      END AS read_rate,
      MAX(CASE WHEN cc.status = 'READ' THEN cc.updated_at END) AS last_read_at
    FROM wa_campaign_contacts cc
    JOIN wa_campaigns c ON c.id = cc.campaign_id
    WHERE c.salon_id = $1
    GROUP BY '+' || REGEXP_REPLACE(cc.phone, '[^0-9]', '', 'g')
    HAVING COUNT(CASE WHEN cc.status = 'READ' THEN 1 END) > 0
    ORDER BY campaigns_read DESC, read_rate DESC
    LIMIT 10
  `, [salonId])
  return rows
},
}