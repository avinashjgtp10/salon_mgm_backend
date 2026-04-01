import { dashboardRepository } from './dashboard.repository'
import { WADashboardStats } from './dashboard.types'

export const dashboardService = {

  async getStats(salonId: string): Promise<WADashboardStats> {
    return dashboardRepository.getStats(salonId)
  },
}
