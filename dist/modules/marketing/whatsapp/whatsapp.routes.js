"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_routes_1 = __importDefault(require("./dashboard/dashboard.routes"));
const templates_routes_1 = __importDefault(require("./templates/templates.routes"));
const campaigns_routes_1 = __importDefault(require("./campaigns/campaigns.routes"));
const config_routes_1 = __importDefault(require("./config/config.routes"));
const webhooks_routes_1 = __importDefault(require("./webhooks/webhooks.routes"));
const users_routes_1 = __importDefault(require("./users/users.routes"));
const router = (0, express_1.Router)();
router.use('/dashboard', dashboard_routes_1.default);
router.use('/templates', templates_routes_1.default);
router.use('/campaigns', campaigns_routes_1.default);
router.use('/config', config_routes_1.default);
router.use('/webhooks', webhooks_routes_1.default);
router.use('/users', users_routes_1.default);
exports.default = router;
//# sourceMappingURL=whatsapp.routes.js.map