"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappMetaApi = void 0;
const axios_1 = __importDefault(require("axios"));
const WA_BASE_URL = process.env.WA_BASE_URL ?? 'https://graph.facebook.com';
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v19.0';
exports.whatsappMetaApi = {
    async sendTemplateMessage(params) {
        const template = {
            name: params.templateName,
            language: { code: params.language },
        };
        if (params.components?.length > 0) {
            template.components = params.components;
        }
        const res = await axios_1.default.post(`${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: params.to,
            type: 'template',
            template,
        }, {
            headers: {
                Authorization: `Bearer ${params.accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return res.data;
    },
    async submitTemplate(params) {
        const res = await axios_1.default.post(`${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/message_templates`, {
            name: params.name,
            category: params.category,
            language: params.language,
            components: params.components,
        }, {
            headers: {
                Authorization: `Bearer ${params.accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return res.data;
    },
    async getTemplateStatus(accessToken, templateId) {
        const res = await axios_1.default.get(`${WA_BASE_URL}/${WA_API_VERSION}/${templateId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        return res.data;
    },
    async testConnection(phoneNumberId, accessToken) {
        const res = await axios_1.default.get(`${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        return res.data;
    },
};
//# sourceMappingURL=whatsapp.api.js.map