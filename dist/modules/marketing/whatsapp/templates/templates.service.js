"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templatesService = void 0;
const templates_repository_1 = require("./templates.repository");
const config_repository_1 = require("../config/config.repository");
const whatsapp_service_1 = require("../whatsapp.service");
exports.templatesService = {
    async getAll(salonId) { return templates_repository_1.templatesRepo.findAll(salonId); },
    async getById(id, salonId) {
        const t = await templates_repository_1.templatesRepo.findById(id, salonId);
        if (!t)
            throw { statusCode: 404, message: 'Template not found' };
        return t;
    },
    async create(salonId, data) {
        const config = await config_repository_1.configRepo.findBySalonId(salonId);
        if (!config)
            throw { statusCode: 400, message: 'WhatsApp not configured' };
        const components = [];
        if (data.headerType && data.headerType !== 'none') {
            if (data.headerType === 'text' && data.headerText) {
                components.push({ type: 'HEADER', format: 'TEXT', text: data.headerText });
            }
            else if (['image', 'video', 'document'].includes(data.headerType)) {
                components.push({ type: 'HEADER', format: data.headerType.toUpperCase() });
            }
        }
        components.push({ type: 'BODY', text: data.bodyText });
        if (data.footerText)
            components.push({ type: 'FOOTER', text: data.footerText });
        if (data.buttons?.length > 0) {
            components.push({
                type: 'BUTTONS',
                buttons: data.buttons.map((b) => {
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
            const metaRes = await whatsapp_service_1.whatsappService.submitTemplate({
                wabaId: config.waba_id, accessToken: config.access_token,
                name: data.name, category: data.category, language: data.language, components,
            });
            metaTemplateId = metaRes.id;
            status = metaRes.status || 'PENDING';
        }
        catch { }
        return templates_repository_1.templatesRepo.create(salonId, {
            name: data.name, category: data.category, language: data.language,
            header_type: data.headerType || 'none', header_text: data.headerText,
            body_text: data.bodyText, footer_text: data.footerText,
            buttons: data.buttons || [], meta_template_id: metaTemplateId, status,
        });
    },
    async syncStatus(id, salonId) {
        const template = await templates_repository_1.templatesRepo.findById(id, salonId);
        if (!template)
            throw { statusCode: 404, message: 'Template not found' };
        const config = await config_repository_1.configRepo.findBySalonId(salonId);
        if (!config || !template.meta_template_id)
            return templates_repository_1.templatesRepo.updateStatus(id, 'APPROVED');
        try {
            const meta = await whatsapp_service_1.whatsappService.getTemplateStatus(config.access_token, template.meta_template_id);
            return templates_repository_1.templatesRepo.updateStatus(id, meta.status, template.meta_template_id, meta.rejected_reason);
        }
        catch {
            return templates_repository_1.templatesRepo.updateStatus(id, 'APPROVED');
        }
    },
    async delete(id, salonId) {
        const deleted = await templates_repository_1.templatesRepo.delete(id, salonId);
        if (!deleted)
            throw { statusCode: 404, message: 'Template not found' };
        return { message: 'Template deleted' };
    },
};
//# sourceMappingURL=templates.service.js.map