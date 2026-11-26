import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { superAdminController } from "./super-admin.controller";
import { superAdminActivityLogger } from "./super-admin-activity";
import { superAdminOwnerOnly } from "./super-admin-owner.middleware";
import { salonClientInvoicesController } from "../salon-client-invoices/salon-client-invoices.controller";
import waConfigSuperAdminRoutes from "../marketing/whatsapp/config/config.super-admin.routes";
import { pricingSuperAdminRoutes } from "../marketing/whatsapp/pricing/pricing.routes";
import clientActivityRoutes from "../client-activity/client-activity.super-admin.routes";
import clientManagementRoutes from "../client-management/client-management.routes";
import salonModulesRoutes from "../salon-modules/salon-modules.routes";
import aiCredentialsRoutes from "../ai-credentials/ai-credentials.routes";
import modulePlansRoutes from "../module-plans/module-plans.routes";
import salonSubscriptionRoutes from "../salon-subscription/salon-subscription.routes";
import planPricingRoutes from "../plan-pricing/plan-pricing.routes";
import subscriptionDurationRoutes from "../subscription-durations/subscription-durations.routes";
import countryPricingRoutes from "../plan-pricing/country-pricing.routes";
import paymentTrackingRoutes from "../payment-tracking/payment-tracking.routes";
import paymentGatewayRoutes from "../payment-gateway/payment-gateway.routes";
import billingIssuesRoutes from "../billing-issues/billing-issues.routes";
import platformIntegrationsRoutes from "../platform-integrations/platform-integrations.routes";
import subscriptionInvoiceRoutes from "../subscription-invoices/subscription-invoices.routes";
import clientAnnouncementsRoutes from "../client-announcements/client-announcements.routes";
import marketingLogsRoutes from "../marketing-logs/marketing-logs.routes";
import platformScheduledMessagesRoutes from "../platform-scheduled-messages/platform-scheduled-messages.routes";

const router = Router();

// ── Public: dedicated super-admin login (no JWT required) ────────────────────
router.post("/login", superAdminController.login);

// ── All routes below require valid JWT + super_admin role ─────────────────────
router.use(authMiddleware, superAdminMiddleware);
// Records the account / salon changes made by whoever is signed in (shown to the owner in Developer Activity).
router.use(superAdminActivityLogger);

// Client Activity Tracking: Web + App logins and usage per account (Super Admin only).
// Client Activity (web/app usage across accounts) is for the owner account only. Client Management is open to team members but scoped to their own records.
router.use("/client-activity", superAdminOwnerOnly, clientActivityRoutes);
router.use("/client-management", clientManagementRoutes);   // scoped per team member inside; see client-management.routes.ts

// A salon's WhatsApp (Meta Cloud API) connection — managed here, by us, not by the salon.
router.use("/salons/:salonId/wa-config", waConfigSuperAdminRoutes);
// Meta's WhatsApp price list: when it was last refreshed, and refresh it now.
router.use("/wa-pricing", pricingSuperAdminRoutes);

// Salon Customization: lock/unlock whole modules for one salon.
router.use("/salon-modules", salonModulesRoutes);
// LUNOX (AI): a salon's own Cloudflare key — present = LUNOX on for that salon, absent = locked.
router.use("/ai-credentials", aiCredentialsRoutes);
router.use("/module-plans", modulePlansRoutes);
router.use("/salon-subscription", salonSubscriptionRoutes);
router.use("/plan-pricing", planPricingRoutes);
// Dynamic subscription durations: the purchasable 3 / 6 / 12 month or custom options per plan, with their price and GST.
router.use("/subscription-durations", subscriptionDurationRoutes);
router.use("/country-pricing", countryPricingRoutes);
// Manual customer / website payments, money added and the combined ledger (separate from Razorpay).
router.use("/payment-tracking", paymentTrackingRoutes);
// Platform-wide Razorpay keys (one set for all salons), stored encrypted.
router.use("/payment-gateway", paymentGatewayRoutes);
// Subscription payments that need a person: parked payments, charges after cancellation, failed stops, refunds.
router.use("/billing-issues", billingIssuesRoutes);
// Platform-wide Google sign-in + billing-email settings, secrets stored encrypted.
router.use("/platform-integrations", platformIntegrationsRoutes);
router.use("/subscription-invoices", subscriptionInvoiceRoutes);
// Client Announcements: picks the platform salon and copies salon owners into its client list.
router.use("/client-announcements", clientAnnouncementsRoutes);
// Marketing Logs: every message sent to clients (automation, campaigns, SMS, Email) across all salons.
router.use("/marketing-logs", marketingLogsRoutes);
// Scheduled Messages: SalonOx's own upcoming + sent messages to salon owners (subscription ending, salon deactivated).
router.use("/scheduled-messages", platformScheduledMessagesRoutes);

// Salon-specific permissions
router.get("/salon-permissions/search",       superAdminController.searchSalonsForPermissions);
router.get("/salon-permissions/:salonId",     superAdminController.getSalonPermissionsById);
router.put("/salon-permissions/:salonId",     superAdminController.updateSalonPermissions);

// Recent / Frequent Logins & No-Plan Users
router.get("/recent-logins",         superAdminController.getRecentLogins);
router.get("/frequent-logins",       superAdminController.getFrequentLogins);
router.get("/users-no-plan",         superAdminController.getUsersWithoutSubscription);

// Stats
router.get("/stats",    superAdminController.getStats);

// Dashboard (Overview page) — one POST returns stats, salons, payments, logins, support stats
router.post("/dashboard", superAdminController.getDashboard);
// Redesigned Overview page: everything it shows (KPIs, alerts, charts, activity, issue snapshot) in one GET.
router.get("/overview", superAdminController.getOverview);

// Salons
router.get("/salons",                       superAdminController.getAllSalons);
router.get("/salons/:id/staff",             superAdminController.getSalonStaff);
router.patch("/salons/:id/status",          superAdminController.setSalonStatus);
router.patch("/salons/:id/dummy",           superAdminController.setSalonDummy);
router.patch("/salons/:id/onboarding",      superAdminController.forceOnboarding);
router.post("/salons/:id/impersonate",      superAdminController.impersonateSalon);
router.get("/salons/:id/delete-preview",   superAdminController.getSalonDeletionPreview);
router.post("/salons/:id/restore",          superAdminController.restoreSalon);
router.delete("/salons/:id",               superAdminController.deleteSalon);
router.post("/salons/:id/clear-data",       superAdminController.clearSalonData);

// Delete Account History (super-admin deleteSalon/deleteUser audit trail)
router.get("/deleted-account-history", superAdminController.getDeletedAccountHistory);

// Clean Up Account History (super-admin clearSalonData audit trail)
router.get("/salon-cleanup-history", superAdminController.getSalonCleanupHistory);

// Demo Inquiries (landing page "Schedule a Free Demo" submissions)
router.get("/demo-requests",                superAdminController.getAllDemoRequests);
router.patch("/demo-requests/:id/status",   superAdminController.setDemoRequestStatus);

// Users
router.post("/users/create",                superAdminController.createUser);
router.get("/users",                        superAdminController.getAllUsers);
router.delete("/users/:id",                 superAdminController.deleteUser);
router.put("/users/:id",                    superAdminController.updateUser);
router.patch("/users/:id/status",           superAdminController.setUserStatus);
router.patch("/users/:id/role",             superAdminController.setUserRole);
router.post("/users/:id/reset-password",    superAdminController.resetUserPassword);
router.post("/users/:id/impersonate",       superAdminController.impersonateUser);
router.get("/users/:id/branch-salons",              superAdminController.getBranchOwnerSalons);
router.put("/users/:id/branch-salons",              superAdminController.assignBranchOwnerSalons);
router.delete("/users/:id/branch-salons/:salonId",  superAdminController.unassignBranchOwnerSalon);

// Payments
router.get("/payments",                     superAdminController.getAllPayments);

// Salon client invoices (GST tax invoices — a salon's own billing to its
// clients, distinct from the salon's own SaaS subscription billing)
router.get("/salons/:id/invoices",                    salonClientInvoicesController.list);
router.get("/salons/:id/invoices/summary",             salonClientInvoicesController.summary);
router.get("/salons/:id/invoices/branches",            salonClientInvoicesController.branches);
router.get("/salons/:id/clients/search",               salonClientInvoicesController.searchClients);
router.get("/salons/:id/invoices/:invoiceId/print",    salonClientInvoicesController.getForPrint);
router.post("/salons/:id/invoices",                    salonClientInvoicesController.create);

export default router;
