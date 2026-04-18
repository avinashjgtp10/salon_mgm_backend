"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templatesService = void 0;
const error_middleware_1 = require("../../../../middleware/error.middleware");
const templates_repository_1 = require("./templates.repository");
const config_repository_1 = require("../config/config.repository");
const whatsapp_api_1 = require("../shared/whatsapp.api");
exports.templatesService = {
    async getAll(salonId) {
        return templates_repository_1.templatesRepository.findAll(salonId);
    },
    async getById(id, salonId) {
        const t = await templates_repository_1.templatesRepository.findById(id, salonId);
        if (!t)
            throw new error_middleware_1.AppError(404, 'Template not found', 'NOT_FOUND');
        return t;
    },
    async create(salonId, body) {
        const config = await config_repository_1.configRepository.findBySalonId(salonId);
        if (!config)
            throw new error_middleware_1.AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED');
        const components = [];
        if (body.header_type && body.header_type !== 'none') {
            if (body.header_type === 'text' && body.header_text) {
                components.push({ type: 'HEADER', format: 'TEXT', text: body.header_text });
            }
            else if (['image', 'video', 'document'].includes(body.header_type)) {
                components.push({ type: 'HEADER', format: body.header_type.toUpperCase() });
            }
        }
        components.push({ type: 'BODY', text: body.body_text });
        if (body.footer_text) {
            components.push({ type: 'FOOTER', text: body.footer_text });
        }
        if (body.buttons && body.buttons.length > 0) {
            components.push({
                type: 'BUTTONS',
                buttons: body.buttons.map(b => {
                    if (b.type === 'quick_reply')
                        return { type: 'QUICK_REPLY', text: b.text };
                    if (b.type === 'url')
                        return { type: 'URL', text: b.text, url: b.value };
                    if (b.type === 'phone')
                        return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.value };
                    return null;
                }),
            });
        }
        let metaTemplateId;
        let status = 'PENDING';
        try {
            const meta = await whatsapp_api_1.whatsappMetaApi.submitTemplate({
                wabaId: config.waba_id,
                accessToken: config.access_token,
                name: body.name,
                category: body.category,
                language: body.language,
                components,
            });
            metaTemplateId = meta.id;
            status = meta.status ?? 'PENDING';
        }
        catch {
            // Save locally even if Meta submission fails
        }
        return templates_repository_1.templatesRepository.create(salonId, {
            ...body,
            meta_template_id: metaTemplateId,
            status,
        });
    },
    async syncStatus(id, salonId) {
        const template = await templates_repository_1.templatesRepository.findById(id, salonId);
        if (!template)
            throw new error_middleware_1.AppError(404, 'Template not found', 'NOT_FOUND');
        const config = await config_repository_1.configRepository.findBySalonId(salonId);
        if (!config || !template.meta_template_id) {
            return templates_repository_1.templatesRepository.updateStatus(id, 'APPROVED');
        }
        try {
            const meta = await whatsapp_api_1.whatsappMetaApi.getTemplateStatus(config.access_token, template.meta_template_id);
            return templates_repository_1.templatesRepository.updateStatus(id, meta.status, template.meta_template_id, meta.rejected_reason ?? null);
        }
        catch {
            return templates_repository_1.templatesRepository.updateStatus(id, 'APPROVED');
        }
    },
    async delete(id, salonId) {
        const deleted = await templates_repository_1.templatesRepository.delete(id, salonId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, 'Template not found', 'NOT_FOUND');
        return { message: 'Template deleted successfully' };
    },
};
//# sourceMappingURL=templates.service.js.map