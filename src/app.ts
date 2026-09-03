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
import commissionRulesRoutes from "./modules/commissionRules/commissionRules.routes";
import payrollRoutes from "./modules/payroll/payroll.routes";
import clientsRoutes from "./modules/clients/clients.routes";
import servicesRoutes from "./modules/services/services.routes";
import { corsMiddleware } from "./middleware/cors.middleware";
import marketplaceRoutes from "./modules/marketplace/marketplace.routes";
import membershipsRoutes from "./modules/memberships/memberships.routes";
import packagesRoutes from "./modules/packages/packages.routes";
import clientPackagesRoutes from "./modules/client-packages/client-packages.routes";
import productsRoutes from "./modules/products/products.routes";
import appointmentsRoutes from "./modules/appointments/appointments.routes";
import calendarRoutes from "./modules/calendar/calendar.routes";
import salesRoutes from "./modules/sales/sales.routes";
import bookingsRoutes from "./modules/bookings/bookings.routes";
import linkBuilderRoutes from "./modules/link-builder/link-builder.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import spotlightRoutes from "./modules/spotlight/spotlight.routes";
import billingRoutes from "./modules/billing/billing.routes";
import pricingRoutes from "./modules/pricing/pricing.routes";
import subscriptionsRoutes from "./modules/subscriptions/subscriptions.routes";
import marketingDashboardRoutes from './modules/marketing/whatsapp/dashboard/dashboard.routes'
import marketingTemplatesRoutes from './modules/marketing/whatsapp/templates/templates.routes'
import marketingCampaignsRoutes from './modules/marketing/whatsapp/campaigns/campaigns.routes'
import marketingConfigRoutes from './modules/marketing/whatsapp/config/config.routes'
import marketingWebhooksRoutes from './modules/marketing/whatsapp/webhooks/webhooks.routes'
import profileRoutes from "./modules/profile/profile.routes";
import inboxRouter from './modules/marketing/whatsapp/inbox/inbox.routes';
import salonDashboardRoutes from "./modules/salon-dashboard/salon-dashboard.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import couponsRoutes from "./modules/coupons/coupons.routes";
import couponDesignsRoutes from "./modules/coupon-designs/coupon-designs.routes";
import brandKitRoutes from "./modules/brand-kit/brand-kit.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import reportsRoutes from "./modules/reports/reports.routes";
import legacyReportsRoutes from "./modules/reports/legacyReports.routes";
import blockedTimesRoutes from "./modules/blocked_times/blocked_times.routes";
import analyticsRoutes from './modules/marketing/whatsapp/analytics/analytics.routes'
import reviewsRoutes from './modules/reviews/reviews.routes'
import reviewsPublicRoutes from './modules/reviews/reviews.public.routes'
import botRoutes from "./modules/bot/bot.routes";
import botQuestionsRoutes from "./modules/bot/bot-questions.routes";
import aiEngineRoutes from "./modules/ai-engine/ai-engine.routes";
import { ensureTable as ensureAiEngineTables } from "./modules/ai-engine/ai-engine.repository";
import waAutomationRoutes from "./modules/whatsapp-automation/whatsapp-automation.routes";
import waScheduledMessagesRoutes from "./modules/whatsapp-automation/wa-scheduled-messages.routes";
import waPurchaseTemplatesRoutes from "./modules/whatsapp-automation/wa-purchase-templates.routes";
import attendanceRoutes from "./modules/attendance/attendance.routes";
import { deviceApiRouter, admsRouter } from "./modules/device/device.routes";
import packageTemplatesRoutes from "./modules/package-templates/package-templates.routes";
import { ensurePackageTemplateTables } from "./modules/package-templates/package-templates.repository";
import clientMembershipsRoutes from "./modules/client-memberships/client-memberships.routes";
import { ensureTable as ensureClientMembershipsTables } from "./modules/client-memberships/client-memberships.repository";
import ewalletRoutes from "./modules/ewallet/ewallet.routes";
import rewardPointsRoutes from "./modules/reward-points/reward-points.routes";
import referralRoutes from "./modules/referral/referral.routes";
import { ensureTable as ensureClientNotesTable } from "./modules/client-notes/client-notes.repository";
import { ensureTable as ensurePaymentsTables } from "./modules/payments/payments.repository";
import { ensureTable as ensureAppointmentsTables } from "./modules/appointments/appointments.repository";
import { ensureTable as ensureTipTables } from "./modules/tips/tipCalculation.service";
import cashManagementRoutes from "./modules/cash-management/cash-management.routes";
import { ensureCashManagementTables } from "./modules/cash-management/cash-management.repository";
import superAdminRoutes from "./modules/super-admin/super-admin.routes";
import demoRequestsRoutes from "./modules/demo-requests/demo-requests.routes";
import supportRoutes from "./modules/support/support.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import deploymentAnnouncementsRoutes from "./modules/deployment-announcements/deployment-announcements.routes";
import enquiriesRoutes from "./modules/enquiries/enquiries.routes";
import { emailService } from "./modules/utils/email.service";
import swaggerUi from "swagger-ui-express";
import path from "path";

// ── Subscription gate ──────────────────────────────────────────────────────────
//import { subscriptionMiddleware } from "./middleware/subscription.middleware";

const app: Application = express();
app.set("trust proxy", 1);
// Express 5 defaults to the built-in 'simple' query parser, which doesn't
// understand bracket-notation arrays (status[]=A&status[]=B) — axios's
// default array serialization uses exactly that format. 'extended' restores
// the qs-based parser (Express 4's old default) so any endpoint that accepts
// an array query param (multi-select filters, etc.) actually receives it as
// an array instead of a literal "key[]" string that's silently ignored.
app.set("query parser", "extended");

// Bootstrap package-template tables (idempotent)
ensurePackageTemplateTables().catch(err =>
  logger.warn("package-templates table init warning:", err?.message ?? err),
);

// Bootstrap client-memberships tables (idempotent)
ensureClientMembershipsTables().catch(err =>
  logger.warn("client-memberships table init warning:", err?.message ?? err),
);

// Bootstrap payments table wallet column (idempotent)
ensurePaymentsTables().catch(err =>
  logger.warn("payments table init warning:", err?.message ?? err),
);

// Bootstrap client_notes table (idempotent)
ensureClientNotesTable().catch(err =>
  logger.warn("client_notes table init warning:", err?.message ?? err),
);

// Bootstrap appointments table apply_membership_wallet column (idempotent)
ensureAppointmentsTables().catch(err =>
  logger.warn("appointments table init warning:", err?.message ?? err),
);

// Bootstrap cash-management tables (idempotent)
ensureCashManagementTables().catch(err =>
  logger.warn("cash-management table init warning:", err?.message ?? err),
);

// Bootstrap tip_earned/tip_settlements tables (idempotent) — Tip Settle
ensureTipTables().catch(err =>
  logger.warn("tip tables init warning:", err?.message ?? err),
);

// Bootstrap ai-engine (LUNOX) tables (idempotent)
ensureAiEngineTables().catch(err =>
  logger.warn("ai-engine table init warning:", err?.message ?? err),
);

// purchases/purchase_items/salons.next_purchase_seq: NOT auto-run here — see
// Migration/create_purchases_tables.sql, run by hand per environment.

// Security middleware
app.use(helmet());

app.use(corsMiddleware);

// ADMS biometric machine protocol — mounted BEFORE body parsers so that
// ZKTeco/ESSL devices (which send application/x-www-form-urlencoded) don't
// have their raw text body consumed by the global urlencoded parser.
app.use("/iclock", admsRouter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve uploaded files as static assets
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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

// ── Test email endpoint (development only) ─────────────────────────────────────
app.get("/api/v1/test-email", async (_req, res) => {
  const smtpInfo = {
    host: config.smtp.host,
    port: config.smtp.port,
    user: config.smtp.user,
    from: config.smtp.from,
    passLen: config.smtp.pass?.length ?? 0,
  };
  logger.info("[test-email] SMTP config:", smtpInfo);

  try {
    // Step 1: verify SMTP connection
    try {
      await emailService.verifyConnection();
      logger.info("[test-email] SMTP connection verified OK");
    } catch (verifyErr: any) {
      logger.error("[test-email] SMTP verify FAILED:", verifyErr?.message ?? verifyErr);
      return res.status(500).json({
        success: false,
        step: "smtp_verify",
        error: verifyErr?.message ?? "SMTP connection failed",
        smtpInfo,
      });
    }

    // Step 2: send test email — use query param ?to=owner@email.com or defaults to smtp user for diagnostics only
    const testTo = ((_req as any).query?.to as string) || config.smtp.user;
    await emailService.sendNewAppointmentEmail({
      to:            testTo,
      salonName:     "Test Salon",
      clientName:    "Test Client",
      services:      "Haircut, Styling",
      date:          new Date().toLocaleDateString("en-IN"),
      time:          new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      appointmentId: "TEST-001",
    });
    logger.info("[test-email] Test email sent successfully to", testTo);
    return res.json({ success: true, message: `Test email sent to ${testTo}`, smtpInfo });
  } catch (err: any) {
    logger.error("[test-email] sendMail FAILED:", err?.message ?? err);
    return res.status(500).json({ success: false, step: "send_mail", error: err?.message ?? "Unknown error", smtpInfo });
  }
});

// ✅ API ROUTES (MUST be before 404)
app.use("/api/v1/auth", authRoutes);
// Alias: Google OAuth console uses /api/v1/oauth/google/callback as redirect URI
app.use("/api/v1/oauth", authRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/pricing", pricingRoutes);
app.use("/api/v1/subscriptions", subscriptionsRoutes);
app.use("/api/v1/webhooks", marketingWebhooksRoutes);
// Alias: some Meta app webhook configs point at a bare "/webhook" path. Accept
// it too so inbound messages/verification work regardless of which callback URL
// a WABA's subscription uses. Reuses the exact same global webhook handlers
// (salon is identified by phone_number_id inside the payload, so this is safe).
app.use("/webhook", marketingWebhooksRoutes);
app.use("/api/v1/profile", profileRoutes);

// ── Subscription gate — applied after exempt routes are registered ─────────────
// Every route registered BELOW this line requires an active/trialing subscription.
// Routes above (auth, billing, subscriptions, webhooks, profile) are always accessible.
//app.use(subscriptionMiddleware);

app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/categories", categoriesRoutes);
app.use("/api/v1/salons", salonsRoutes);
app.use("/api/v1/branches", branchesRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/commission-rules", commissionRulesRoutes);
app.use("/api/v1/payroll", payrollRoutes);
app.use("/api/v1/clients", clientsRoutes);
app.use("/api/v1/services", servicesRoutes);
app.use("/api/v1/marketplace", marketplaceRoutes);
app.use("/api/v1/memberships", membershipsRoutes);
app.use("/api/v1/packages", packagesRoutes);
app.use("/api/v1/client-packages", clientPackagesRoutes);
app.use("/api/v1/products", productsRoutes);
app.use("/api/v1/appointments", appointmentsRoutes);
app.use("/api/v1/bookings", bookingsRoutes);
app.use("/api/v1/link-builder", linkBuilderRoutes);
app.use("/api/v1/calendar", calendarRoutes);
app.use("/api/v1/sales", salesRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/spotlight", spotlightRoutes);
//app.use('/api/v1//dashboard', marketingDashboardRoutes)
app.use('/api/v1/marketing/dashboard', marketingDashboardRoutes);
app.use('/api/v1/marketing/analytics', analyticsRoutes)
app.use('/api/v1/templates', marketingTemplatesRoutes)
app.use('/api/v1/campaigns', marketingCampaignsRoutes)
app.use('/api/v1/wa-config', marketingConfigRoutes)
app.use('/api/v1/reviews', reviewsRoutes)
// PUBLIC — client-facing feedback form, deep-linked from the review_request
// WhatsApp button, no login.
app.use('/api/v1/feedback', reviewsPublicRoutes)
app.use('/api/v1/inbox', inboxRouter);
app.use("/api/v1/dashboard", salonDashboardRoutes);
app.use("/api/v1/coupons", couponsRoutes);
app.use("/api/v1/coupon-designs", couponDesignsRoutes);
app.use("/api/v1/brand-kit", brandKitRoutes);
app.use("/api/v1/payments", paymentsRoutes);
app.use("/api/v1/blocked-times", blockedTimesRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/bot", botRoutes);
app.use("/api/v1/bot-questions", botQuestionsRoutes);
app.use("/api/v1/ai-engine", aiEngineRoutes);
app.use("/api/report", reportsRoutes);
app.use("/api/v1/reports", legacyReportsRoutes);
app.use("/api/v1/cash-management", cashManagementRoutes);
app.use("/api/v1/wa-automation", waAutomationRoutes);
app.use("/api/v1/wa-automation/purchase-templates", waPurchaseTemplatesRoutes);
app.use("/api/v1/wa-automation/scheduled", waScheduledMessagesRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/devices", deviceApiRouter);
app.use("/api/v1/package-templates", packageTemplatesRoutes);
app.use("/api/v1/client-memberships", clientMembershipsRoutes);
app.use("/api/v1/ewallet", ewalletRoutes);
app.use("/api/v1/reward-points", rewardPointsRoutes);
app.use("/api/v1/referral", referralRoutes);
app.use("/api/v1/super-admin", superAdminRoutes);
app.use("/api/v1/demo-requests", demoRequestsRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1/notifications", notificationsRoutes);
app.use("/api/v1/deployment-announcements", deploymentAnnouncementsRoutes);
app.use("/api/v1/enquiries", enquiriesRoutes);

const swaggerDocument = require(path.join(__dirname, "../docs/api/swagger-gen.json"));
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
