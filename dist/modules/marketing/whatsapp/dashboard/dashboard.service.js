"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardService = void 0;
const dashboard_repository_1 = require("./dashboard.repository");
exports.dashboardService = {
    async getStats(salonId) {
        return dashboard_repository_1.dashboardRepository.getStats(salonId);
    },
};
//# sourceMappingURL=dashboard.service.js.map