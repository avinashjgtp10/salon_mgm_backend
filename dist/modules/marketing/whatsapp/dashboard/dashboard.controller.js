"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardController = void 0;
const dashboard_service_1 = require("./dashboard.service");
exports.dashboardController = {
    async getStats(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend reads r.data directly (no sendSuccess wrapper)
            const data = await dashboard_service_1.dashboardService.getStats(salonId);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=dashboard.controller.js.map