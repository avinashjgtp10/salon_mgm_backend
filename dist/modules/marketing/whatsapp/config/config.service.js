"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configService = void 0;
const axios_1 = __importDefault(require("axios"));
const config_repository_1 = require("./config.repository");
const WA_BASE_URL = process.env.WA_BASE_URL || 'https://graph.facebook.com';
const WA_API_VERSION = process.env.WA_API_VERSION || 'v19.0';
exports.configService = {
    async getConfig(salonId) {
        const config = await config_repository_1.configRepo.findBySalonId(salonId);
        if (!config)
            return null;
        return { ...config, access_token: config.access_token.slice(0, 8) + '••••••••' };
    },
    async saveConfig(salonId, data) {
        return config_repository_1.configRepo.upsert(salonId, {
            phone_number_id: data.phoneNumberId,
            waba_id: data.wabaId,
            access_token: data.accessToken,
            webhook_verify_token: data.webhookVerifyToken,
            display_phone: data.displayPhone,
        });
    },
    async testConnection(salonId) {
        const config = await config_repository_1.configRepo.findBySalonId(salonId);
        if (!config)
            throw { statusCode: 400, message: 'WhatsApp not configured' };
        const url = `${WA_BASE_URL}/${WA_API_VERSION}/${config.phone_number_id}`;
        const res = await axios_1.default.get(url, {
            headers: { Authorization: `Bearer ${config.access_token}` },
            params: { fields: 'display_phone_number,quality_rating,messaging_limit_tier' },
        });
        const d = res.data;
        await config_repository_1.configRepo.setVerified(salonId, d.display_phone_number, d.quality_rating || 'GREEN', d.messaging_limit_tier || 1);
        return { connected: true, displayPhone: d.display_phone_number, quality: d.quality_rating, tier: d.messaging_limit_tier };
    },
};
//# sourceMappingURL=config.service.js.map