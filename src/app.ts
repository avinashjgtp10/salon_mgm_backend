import express, { Application } from "express";
//import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import config from "./config/env";
import logger from "./config/logger";
import { errorHandler } from "./middleware/error.middleware";
import usersRoutes from "./modules/users/users.routes";
import authRoutes from "./modules/auth/auth.routes";
import categoriesRoutes from "./modules/categories/categories.routes";
import salonsRoutes from "./modules/salons/salons.routes";
import branchesRoutes from "./modules/branches/branches.routes";
import staffRoutes from "./modules/staff/staff.routes";
import clientsRoutes from "./modules/clients/clients.routes";
import servicesRoutes from "./modules/services/services.routes";
import { corsMiddleware } from "./middleware/cors.middleware";
import marketplaceRoutes from "./modules/marketplace/marketplace.routes";
import membershipsRoutes from "./modules/memberships/memberships.routes";
import packagesRoutes from "./modules/packages/packages.routes";
import productsRoutes from "./modules/products/products.routes";
import brandsRoutes from "./modules/products/products.routes";
import appointmentsRoutes from "./modules/appointments/appointments.routes";
import salesRoutes from "./modules/sales/sales.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import billingRoutes from "./modules/billing/billing.routes";
import subscriptionsRoutes from "./modules/subscriptions/subscriptions.routes";
import marketingDashboardRoutes from './modules/marketing/whatsapp/dashboard/dashboard.routes'
import marketingTemplatesRoutes from './modules/marketing/whatsapp/templates/templates.routes'
import marketingCampaignsRoutes from './modules/marketing/whatsapp/campaigns/campaigns.routes'
import marketingConfigRoutes    from './modules/marketing/whatsapp/config/config.routes'
import marketingWebhooksRoutes  from './modules/marketing/whatsapp/webhooks/webhooks.routes'
import botRoutes from './modules/bot/bot.routes';
import { botRateLimiter, botLogger } from './modules/bot/bot.middleware';
import profileRoutes from "./modules/profile/profile.routes";
import couponsRoutes from "./modules/coupons/coupons.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import blockedTimesRoutes from "./modules/blocked_times/blocked_times.routes";

import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import path from "path";

const app: Application = express();
app.set("trust proxy", 1);
// Security middleware
app.use(helmet());

app.use(corsMiddleware);
// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Compression
app.use(compression());

// Logging
if (config.env === "development") {
  app.use(morgan("dev"));
} else {
  app.use(
    morgan("combined", {
      stream: { write: (message) => logger.info(message.trim()) },
    }),
  );
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
app.use("/api/v1/auth", authRoutes);
// Alias: Google OAuth console uses /api/v1/oauth/google/callback as redirect URI
app.use("/api/v1/oauth", authRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/categories", categoriesRoutes);
app.use("/api/v1/salons", salonsRoutes);
app.use("/api/v1/branches", branchesRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/clients", clientsRoutes);
app.use("/api/v1/services", servicesRoutes);
app.use("/api/v1/marketplace", marketplaceRoutes);
app.use("/api/v1/memberships", membershipsRoutes);
app.use("/api/v1/packages", packagesRoutes);
app.use("/api/v1/products", productsRoutes);
app.use("/api/v1/brands", brandsRoutes);
app.use("/api/v1/appointments", appointmentsRoutes);
app.use("/api/v1/sales", salesRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/subscriptions", subscriptionsRoutes);
app.use('/api/v1/dashboard', marketingDashboardRoutes)
app.use('/api/v1/templates', marketingTemplatesRoutes)
app.use('/api/v1/campaigns', marketingCampaignsRoutes)
app.use('/api/v1/wa-config', marketingConfigRoutes)
app.use('/api/v1/webhooks',  marketingWebhooksRoutes)
app.use(botLogger);
app.use(botRateLimiter);
app.use('/api/v1/bot', botRoutes);
app.use("/api/v1/profile",  profileRoutes);
app.use("/api/v1/coupons",        couponsRoutes);
app.use("/api/v1/payments",       paymentsRoutes);
app.use("/api/v1/blocked-times",  blockedTimesRoutes);


// Swagger Documentation
const swaggerDocument = YAML.load(path.join(__dirname, "../docs/api/swagger.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

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
app.use(errorHandler);

export default app;
