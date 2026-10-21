import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { superAdminController } from "./super-admin.controller";
import { salonClientInvoicesController } from "../salon-client-invoices/salon-client-invoices.controller";
import waConfigSuperAdminRoutes from "../marketing/whatsapp/config/config.super-admin.routes";
import clientActivityRoutes from "../client-activity/client-activity.super-admin.routes";
import salonModulesRoutes from "../salon-modules/salon-modules.routes";
import modulePlansRoutes from "../module-plans/module-plans.routes";
import salonSubscriptionRoutes from "../salon-subscription/salon-subscription.routes";
import planPricingRoutes from "../plan-pricing/plan-pricing.routes";
import subscriptionInvoiceRoutes from "../subscription-invoices/subscription-invoices.routes";

const router = Router();

// ── Public: dedicated super-admin login (no JWT required) ────────────────────
router.post("/login", superAdminController.login);

// ── All routes below require valid JWT + super_admin role ─────────────────────
router.use(authMiddleware, superAdminMiddleware);

// Client Activity Tracking: Web + App logins and usage per account (Super Admin only).
router.use("/client-activity", clientActivityRoutes);

// A salon's WhatsApp (Meta Cloud API) connection — managed here, by us, not by the salon.
router.use("/salons/:salonId/wa-config", waConfigSuperAdminRoutes);

// Salon Customization: lock/unlock whole modules for one salon.
router.use("/salon-modules", salonModulesRoutes);
router.use("/module-plans", modulePlansRoutes);
router.use("/salon-subscription", salonSubscriptionRoutes);
router.use("/plan-pricing", planPricingRoutes);
router.use("/subscription-invoices", subscriptionInvoiceRoutes);

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

// Salons
router.get("/salons",                       superAdminController.getAllSalons);
router.get("/salons/:id/staff",             superAdminController.getSalonStaff);
router.patch("/salons/:id/status",          superAdminController.setSalonStatus);
router.patch("/salons/:id/dummy",           superAdminController.setSalonDummy);
router.patch("/salons/:id/onboarding",      superAdminController.forceOnboarding);
router.post("/salons/:id/impersonate",      superAdminController.impersonateSalon);
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
