"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waUsersController = exports.waWebhooksController = exports.waDashboardController = exports.waCampaignsController = exports.waTemplatesController = exports.waConfigController = void 0;
const response_util_1 = require("../../utils/response.util");
const whatsapp_service_1 = require("./whatsapp.service");
const getSalonId = (req) => {
    const salonId = req.user?.salonId;
    if (!salonId)
        throw { statusCode: 400, message: 'salonId missing from token', code: 'SALON_ID_MISSING' };
    return salonId;
};
exports.waConfigController = {
    async getConfig(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waConfigService.getConfig(getSalonId(req)), 'Config fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async saveConfig(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waConfigService.saveConfig(getSalonId(req), req.body), 'Config saved');
        }
        catch (e) {
            return next(e);
        }
    },
    async testConnection(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waConfigService.testConnection(getSalonId(req)), 'Connection successful');
        }
        catch (e) {
            return next(e);
        }
    },
};
exports.waTemplatesController = {
    async getAll(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waTemplatesService.getAll(getSalonId(req)), 'Templates fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async getById(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waTemplatesService.getById(String(req.params.templateId), getSalonId(req)), 'Template fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 201, await whatsapp_service_1.waTemplatesService.create(getSalonId(req), req.body), 'Template created');
        }
        catch (e) {
            return next(e);
        }
    },
    async syncStatus(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waTemplatesService.syncStatus(String(req.params.templateId), getSalonId(req)), 'Template synced');
        }
        catch (e) {
            return next(e);
        }
    },
    async delete(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waTemplatesService.delete(String(req.params.templateId), getSalonId(req)), 'Template deleted');
        }
        catch (e) {
            return next(e);
        }
    },
};
exports.waCampaignsController = {
    async getAll(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.getAll(getSalonId(req)), 'Campaigns fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async getById(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.getById(String(req.params.campaignId), getSalonId(req)), 'Campaign fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 201, await whatsapp_service_1.waCampaignsService.create(getSalonId(req), req.body), 'Campaign created');
        }
        catch (e) {
            return next(e);
        }
    },
    async pause(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.pause(String(req.params.campaignId), getSalonId(req)), 'Campaign paused');
        }
        catch (e) {
            return next(e);
        }
    },
    async resume(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.resume(String(req.params.campaignId), getSalonId(req)), 'Campaign resumed');
        }
        catch (e) {
            return next(e);
        }
    },
    async getContacts(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.getContacts(String(req.params.campaignId), getSalonId(req), req.query.status), 'Contacts fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async getReport(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waCampaignsService.getReport(String(req.params.campaignId), getSalonId(req), String(req.params.type)), 'Report fetched');
        }
        catch (e) {
            return next(e);
        }
    },
};
exports.waDashboardController = {
    async getDashboard(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waDashboardService.getDashboard(getSalonId(req)), 'Dashboard fetched');
        }
        catch (e) {
            return next(e);
        }
    },
};
exports.waWebhooksController = {
    async verify(req, res, next) {
        try {
            const result = await whatsapp_service_1.waWebhooksService.verify(String(req.params.salonId), req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
            return res.status(200).send(result);
        }
        catch (e) {
            return next(e);
        }
    },
    async handle(req, res, next) {
        try {
            res.status(200).json({ success: true });
            await whatsapp_service_1.waWebhooksService.handleWebhook(req.body);
        }
        catch (e) {
            return next(e);
        }
    },
    async getEvents(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waWebhooksService.getRecentEvents(getSalonId(req), req.query.campaignId), 'Events fetched');
        }
        catch (e) {
            return next(e);
        }
    },
};
exports.waUsersController = {
    async getAll(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waUsersService.getAll(getSalonId(req)), 'Users fetched');
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 201, await whatsapp_service_1.waUsersService.create(getSalonId(req), req.body), 'User created');
        }
        catch (e) {
            return next(e);
        }
    },
    async remove(req, res, next) {
        try {
            return (0, response_util_1.sendSuccess)(res, 200, await whatsapp_service_1.waUsersService.remove(String(req.params.userId), getSalonId(req)), 'User removed');
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=whatsapp.controller.js.map