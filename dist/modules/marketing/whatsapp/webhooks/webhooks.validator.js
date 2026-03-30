"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWebhookQuery = void 0;
// Webhook bodies come from Meta — no validation needed on incoming
const validateWebhookQuery = (_req, _res, next) => next();
exports.validateWebhookQuery = validateWebhookQuery;
//# sourceMappingURL=webhooks.validator.js.map