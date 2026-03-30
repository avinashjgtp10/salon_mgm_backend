"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardService = void 0;
const dashboard_repository_1 = require("./dashboard.repository");
exports.dashboardService = {
    async getDashboard(salonId) {
        const [stats, dailyVolume, waConfig] = await Promise.all([
            dashboard_repository_1.dashboardRepo.getStats(salonId),
            dashboard_repository_1.dashboardRepo.getDailyVolume(salonId),
            dashboard_repository_1.dashboardRepo.getWAConfig(salonId),
        ]);
        return { ...stats, dailyVolume, waConfig };
    },
};
//# sourceMappingURL=dashboard.service.js.map