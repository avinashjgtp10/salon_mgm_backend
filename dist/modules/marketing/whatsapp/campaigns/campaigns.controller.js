"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignsController = void 0;
const response_util_1 = require("../../../utils/response.util");
const campaigns_service_1 = require("./campaigns.service");
exports.campaignsController = {
    async getAll(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await campaigns_service_1.campaignsService.getAll(salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Campaigns fetched successfully');
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
            const data = await campaigns_service_1.campaignsService.getById(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Campaign fetched successfully');
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
            const data = await campaigns_service_1.campaignsService.create(salonId, req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, 'Campaign created successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async pause(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await campaigns_service_1.campaignsService.pause(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Campaign paused successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async resume(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await campaigns_service_1.campaignsService.resume(req.params.id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Campaign resumed successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async getContacts(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const status = req.query.status;
            const data = await campaigns_service_1.campaignsService.getContacts(req.params.id, salonId, status);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Contacts fetched successfully');
        }
        catch (e) {
            return next(e);
        }
    },
    async getReport(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const data = await campaigns_service_1.campaignsService.getReport(req.params.id, salonId, req.params.type);
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Report fetched successfully');
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=campaigns.controller.js.map