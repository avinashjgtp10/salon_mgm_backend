import { dashboardRepository } from './dashboard.repository'
import { WADashboardStats } from './dashboard.types'

export const dashboardService = {

  async getStats(salonId: string): Promise<WADashboardStats> {
  const result = await dashboardRepository.getStats(salonId)
  console.log('Dashboard stats:', JSON.stringify({
    topCampaigns:    result.topCampaigns?.length,
    topTemplates:    result.topTemplates?.length,
    engagedContacts: result.engagedContacts?.length,
  }))
  return result
  },
}
