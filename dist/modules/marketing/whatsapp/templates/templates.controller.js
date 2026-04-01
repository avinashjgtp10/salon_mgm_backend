"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templatesController = void 0;
const templates_service_1 = require("./templates.service");
exports.templatesController = {
    async getAll(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await templates_service_1.templatesService.getAll(salonId) });
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
            res.json({ success: true, data: await templates_service_1.templatesService.getById(req.params.id, salonId) });
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
            res.status(201).json({ success: true, data: await templates_service_1.templatesService.create(salonId, req.body) });
        }
        catch (err) {
            next(err);
        }
    },
    async syncStatus(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await templates_service_1.templatesService.syncStatus(req.params.id, salonId) });
        }
        catch (err) {
            next(err);
        }
    },
    async delete(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            res.json({ success: true, data: await templates_service_1.templatesService.delete(req.params.id, salonId) });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=templates.controller.js.map