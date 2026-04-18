"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configService = void 0;
const error_middleware_1 = require("../../../../middleware/error.middleware");
const config_repository_1 = require("./config.repository");
const whatsapp_api_1 = require("../shared/whatsapp.api");
exports.configService = {
    async getConfig(salonId) {
        const config = await config_repository_1.configRepository.findBySalonId(salonId);
        if (!config)
            return null;
        return {
            ...config,
            access_token: config.access_token.slice(0, 8) + '••••••••',
        };
    },
    async saveConfig(salonId, body) {
        return config_repository_1.configRepository.upsert(salonId, body);
    },
    async testConnection(salonId) {
        const config = await config_repository_1.configRepository.findBySalonId(salonId);
        if (!config)
            throw new error_middleware_1.AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED');
        const d = await whatsapp_api_1.whatsappMetaApi.testConnection(config.phone_number_id, config.access_token);
        await config_repository_1.configRepository.setVerified(salonId, d.display_phone_number, d.quality_rating ?? 'GREEN', d.messaging_limit_tier ?? 1);
        return {
            success: true,
            tier: String(d.messaging_limit_tier ?? 1),
            qualityRating: d.quality_rating ?? 'GREEN',
        };
    },
};
//# sourceMappingURL=config.service.js.map