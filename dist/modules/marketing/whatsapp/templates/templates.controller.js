"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templatesController = void 0;
const response_util_1 = require("../../../utils/response.util");
const templates_service_1 = require("./templates.service");
exports.templatesController = {
    async getAll(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await templates_service_1.templatesService.getAll(salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Templates fetched successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async getById(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await templates_service_1.templatesService.getById(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Template fetched successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await templates_service_1.templatesService.create(salonId, req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, 'Template created successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async syncStatus(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await templates_service_1.templatesService.syncStatus(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Template synced successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async delete(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await templates_service_1.templatesService.delete(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Template deleted successfully');
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=templates.controller.js.map