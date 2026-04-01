"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardController = void 0;
const dashboard_service_1 = require("./dashboard.service");
exports.dashboardController = {
    async getDashboard(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const data = await dashboard_service_1.dashboardService.getDashboard(salonId);
            res.json({ success: true, data });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=dashboard.controller.js.map