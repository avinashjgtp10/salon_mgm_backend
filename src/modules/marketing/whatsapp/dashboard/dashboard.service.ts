import { dashboardRepository } from './dashboard.repository'
import { WADashboardStats, WATopTemplate, WAEngagedContact } from './dashboard.types'

export const dashboardService = {

  async getStats(salonId: string): Promise<WADashboardStats> {
  return dashboardRepository.getStats(salonId)
  },

  async getTopTemplatesPaged(salonId: string, page: number, limit: number): Promise<{ rows: WATopTemplate[]; total: number }> {
    return dashboardRepository.getTopTemplatesPaged(salonId, page, limit)
  },

  async getEngagedContactsPaged(salonId: string, page: number, limit: number): Promise<{ rows: WAEngagedContact[]; total: number }> {
    return dashboardRepository.getEngagedContactsPaged(salonId, page, limit)
  },
}
