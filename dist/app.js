"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
//import cors from "cors";
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const env_1 = __importDefault(require("./config/env"));
const logger_1 = __importDefault(require("./config/logger"));
const error_middleware_1 = require("./middleware/error.middleware");
const users_routes_1 = __importDefault(require("./modules/users/users.routes"));
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const categories_routes_1 = __importDefault(require("./modules/categories/categories.routes"));
const salons_routes_1 = __importDefault(require("./modules/salons/salons.routes"));
const branches_routes_1 = __importDefault(require("./modules/branches/branches.routes"));
const staff_routes_1 = __importDefault(require("./modules/staff/staff.routes"));
const clients_routes_1 = __importDefault(require("./modules/clients/clients.routes"));
const services_routes_1 = __importDefault(require("./modules/services/services.routes"));
const cors_middleware_1 = require("./middleware/cors.middleware");
const marketplace_routes_1 = __importDefault(require("./modules/marketplace/marketplace.routes"));
const memberships_routes_1 = __importDefault(require("./modules/memberships/memberships.routes"));
const products_routes_1 = __importDefault(require("./modules/products/products.routes"));
const products_routes_2 = __importDefault(require("./modules/products/products.routes"));
const appointments_routes_1 = __importDefault(require("./modules/appointments/appointments.routes"));
const calendar_routes_1 = __importDefault(require("./modules/calendar/calendar.routes"));
const sales_routes_1 = __importDefault(require("./modules/sales/sales.routes"));
const inventory_routes_1 = __importDefault(require("./modules/inventory/inventory.routes"));
const billing_routes_1 = __importDefault(require("./modules/billing/billing.routes"));
const subscriptions_routes_1 = __importDefault(require("./modules/subscriptions/subscriptions.routes"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const yamljs_1 = __importDefault(require("yamljs"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
app.set("trust proxy", 1);
// Security middleware
app.use((0, helmet_1.default)());
app.use(cors_middleware_1.corsMiddleware);
// Body parsing middleware
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" }));
// Compression
app.use((0, compression_1.default)());
// Logging
if (env_1.default.env === "development") {
    app.use((0, morgan_1.default)("dev"));
}
else {
    app.use((0, morgan_1.default)("combined", {
        stream: { write: (message) => logger_1.default.info(message.trim()) },
    }));
}
// Health check
app.get("/health", (_req, res) => {
    res.json({
        success: true,
        message: "Server is healthy",
        timestamp: new Date().toISOString(),
    });
});
// ✅ API ROUTES (MUST be before 404)
app.use("/api/v1/auth", auth_routes_1.default);
// Alias: Google OAuth console uses /api/v1/oauth/google/callback as redirect URI
app.use("/api/v1/oauth", auth_routes_1.default);
app.use("/api/v1/users", users_routes_1.default);
app.use("/api/v1/categories", categories_routes_1.default);
app.use("/api/v1/salons", salons_routes_1.default);
app.use("/api/v1/branches", branches_routes_1.default);
app.use("/api/v1/staff", staff_routes_1.default);
app.use("/api/v1/clients", clients_routes_1.default);
app.use("/api/v1/services", services_routes_1.default);
app.use("/api/v1/marketplace", marketplace_routes_1.default);
app.use("/api/v1/memberships", memberships_routes_1.default);
app.use("/api/v1/products", products_routes_1.default);
app.use("/api/v1/brands", products_routes_2.default);
app.use("/api/v1/appointments", appointments_routes_1.default);
app.use("/api/v1/calendar", calendar_routes_1.default);
app.use("/api/v1/sales", sales_routes_1.default);
app.use("/api/v1/inventory", inventory_routes_1.default);
app.use("/api/v1/billing", billing_routes_1.default);
app.use("/api/v1/subscriptions", subscriptions_routes_1.default);
// Swagger Documentation
const swaggerDocument = yamljs_1.default.load(path_1.default.join(__dirname, "../docs/api/swagger.yaml"));
app.use("/api-docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerDocument));
// 404 handler (after all routes)
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        error: {
            code: "NOT_FOUND",
            message: "Route not found",
        },
    });
});
// Error handler (must be last)
app.use(error_middleware_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map