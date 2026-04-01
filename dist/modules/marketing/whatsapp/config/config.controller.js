"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configController = void 0;
const config_service_1 = require("./config.service");
exports.configController = {
    async getConfig(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const data = await config_service_1.configService.getConfig(salonId);
            res.json({ success: true, data });
        }
        catch (err) {
            next(err);
        }
    },
    async saveConfig(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const data = await config_service_1.configService.saveConfig(salonId, req.body);
            res.json({ success: true, data });
        }
        catch (err) {
            next(err);
        }
    },
    async testConnection(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const data = await config_service_1.configService.testConnection(salonId);
            res.json({ success: true, data });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=config.controller.js.map