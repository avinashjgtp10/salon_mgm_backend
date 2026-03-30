"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignsController = void 0;
const campaigns_service_1 = require("./campaigns.service");
exports.campaignsController = {
    async getAll(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await campaigns_service_1.campaignsService.getAll(salonId) });
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await campaigns_service_1.campaignsService.getById(req.params.id, salonId) });
        }
        catch (err) {
            next(err);
        }
    },
    async create(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.status(201).json({ success: true, data: await campaigns_service_1.campaignsService.create(salonId, req.body) });
        }
        catch (err) {
            next(err);
        }
    },
    async pause(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await campaigns_service_1.campaignsService.pause(req.params.id, salonId) });
        }
        catch (err) {
            next(err);
        }
    },
    async resume(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await campaigns_service_1.campaignsService.resume(req.params.id, salonId) });
        }
        catch (err) {
            next(err);
        }
    },
    async getContacts(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const status = req.query.status;
            res.json({ success: true, data: await campaigns_service_1.campaignsService.getContacts(req.params.id, salonId, status) });
        }
        catch (err) {
            next(err);
        }
    },
    async downloadReport(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await campaigns_service_1.campaignsService.getReport(req.params.id, salonId, req.params.type) });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=campaigns.controller.js.map