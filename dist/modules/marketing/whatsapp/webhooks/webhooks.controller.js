"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksController = void 0;
const webhooks_service_1 = require("./webhooks.service");
exports.webhooksController = {
    async verify(req, res, next) {
        try {
            const { salonId } = req.params;
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            const result = await webhooks_service_1.webhooksService.verify(salonId, mode, token, challenge);
            res.status(200).send(result);
        }
        catch (err) {
            next(err);
        }
    },
    async handle(req, res, next) {
        try {
            res.status(200).json({ success: true });
            await webhooks_service_1.webhooksService.handleWebhook(req.body);
        }
        catch (err) {
            next(err);
        }
    },
    async getEvents(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ success: false, message: 'salonId missing' });
            const campaignId = req.query.campaignId;
            const data = await webhooks_service_1.webhooksService.getRecentEvents(salonId, campaignId);
            res.json({ success: true, data });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=webhooks.controller.js.map