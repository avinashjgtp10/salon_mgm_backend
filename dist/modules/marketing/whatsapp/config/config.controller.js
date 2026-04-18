"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configController = void 0;
const config_service_1 = require("./config.service");
exports.configController = {
    async getConfig(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.get('/wa-config').then(r => r.data)
            const data = await config_service_1.configService.getConfig(salonId);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
    async saveConfig(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.put('/wa-config', payload).then(r => r.data)
            const data = await config_service_1.configService.saveConfig(salonId, req.body);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
    async testConnection(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.post('/wa-config/test').then(r => r.data)
            const data = await config_service_1.configService.testConnection(salonId);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=config.controller.js.map