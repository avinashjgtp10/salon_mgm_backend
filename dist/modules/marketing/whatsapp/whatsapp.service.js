"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappService = void 0;
const axios_1 = __importDefault(require("axios"));
const database_1 = __importDefault(require("../../../config/database"));
const WA_BASE_URL = process.env.WA_BASE_URL || 'https://graph.facebook.com';
const WA_API_VERSION = process.env.WA_API_VERSION || 'v19.0';
exports.whatsappService = {
    async getSalonConfig(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM whatsapp_configs WHERE salon_id = $1`, [salonId]);
        if (!rows[0])
            throw { statusCode: 400, message: 'WhatsApp not configured for this salon' };
        return rows[0];
    },
    async sendTemplateMessage(params) {
        const url = `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`;
        const template = {
            name: params.templateName,
            language: { code: params.language },
        };
        if (params.components?.length > 0)
            template.components = params.components;
        const res = await axios_1.default.post(url, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: params.to,
            type: 'template',
            template,
        }, {
            headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
        });
        return res.data;
    },
    async submitTemplate(params) {
        const url = `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/message_templates`;
        const res = await axios_1.default.post(url, {
            name: params.name, category: params.category, language: params.language, components: params.components,
        }, {
            headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
        });
        return res.data;
    },
    async getTemplateStatus(accessToken, metaTemplateId) {
        const url = `${WA_BASE_URL}/${WA_API_VERSION}/${metaTemplateId}`;
        const res = await axios_1.default.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { fields: 'id,name,status,quality_score,rejected_reason' },
        });
        return res.data;
    },
};
//# sourceMappingURL=whatsapp.service.js.map