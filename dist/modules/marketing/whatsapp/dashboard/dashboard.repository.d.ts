import { WADashboardStats, WARecentCampaign } from './dashboard.types';
export declare const dashboardRepository: {
    getStats(salonId: string): Promise<WADashboardStats>;
    getRecentCampaigns(salonId: string): Promise<WARecentCampaign[]>;
};
//# sourceMappingURL=dashboard.repository.d.ts.map