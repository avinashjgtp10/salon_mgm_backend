"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksController = void 0;
const response_util_1 = require("../../../utils/response.util");
const webhooks_service_1 = require("./webhooks.service");
exports.webhooksController = {
    async verify(req, res, next) {
        try {
            const salonId = req.params.salonId;
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            const result = await webhooks_service_1.webhooksService.verify(salonId, mode, token, challenge);
            return res.status(200).send(result);
        }
        catch (e) {
            return next(e);
        }
    },
    async handle(req, res, next) {
        try {
            // Respond to Meta immediately
            res.status(200).json({ success: true });
            await webhooks_service_1.webhooksService.handleWebhook(req.body);
        }
        catch (e) {
            return next(e);
        }
    },
    async getEvents(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            const campaignId = req.query.campaignId;
            const data = await webhooks_service_1.webhooksService.getRecentEvents(salonId, campaignId);
            // Frontend: api.get('/webhooks/events').then(r => r.data.data)
            return (0, response_util_1.sendSuccess)(res, 200, data, 'Webhook events fetched successfully');
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=webhooks.controller.js.map