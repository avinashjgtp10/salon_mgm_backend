import pool from '../../../../config/database'
import { WADashboardStats, WARecentCampaign } from './dashboard.types'

export const dashboardRepository = {

  async getStats(salonId: string): Promise<WADashboardStats> {
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(DISTINCT c.id)                                           AS total_campaigns,
        COALESCE(SUM(c.sent_count), 0)                                 AS total_messages_sent,
        COALESCE(SUM(c.delivered_count), 0)                            AS total_delivered,
        COALESCE(SUM(c.read_count), 0)                                 AS total_read,
        COALESCE(SUM(c.failed_count), 0)                               AS total_failed,
        COALESCE(SUM(c.blocked_count), 0)                              AS total_blocked
      FROM wa_campaigns c
      WHERE c.salon_id = $1
    `, [salonId])

    const totalSent      = parseInt(stats.total_messages_sent) || 0
    const totalDelivered = parseInt(stats.total_delivered)     || 0
    const totalRead      = parseInt(stats.total_read)          || 0

    const recentCampaigns = await this.getRecentCampaigns(salonId)

    return {
      totalCampaigns:    parseInt(stats.total_campaigns) || 0,
      totalMessagesSent: totalSent,
      totalDelivered,
      totalRead,
      totalFailed:       parseInt(stats.total_failed)   || 0,
      totalBlocked:      parseInt(stats.total_blocked)  || 0,
      deliveryRate:      totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
      readRate:          totalSent > 0 ? Math.round((totalRead      / totalSent) * 100) : 0,
      recentCampaigns,
    }
  },

  async getRecentCampaigns(salonId: string): Promise<WARecentCampaign[]> {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.status,
        c.total_contacts, c.sent_count, c.delivered_count,
        c.read_count, c.failed_count, c.blocked_count,
        c.created_at, c.completed_at
      FROM wa_campaigns c
      WHERE c.salon_id = $1
      ORDER BY c.created_at DESC
      LIMIT 5
    `, [salonId])
    return rows
  },
}
