import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { salonPlansController } from "./salon-plans.controller";

const router = Router();

// GET /my-features, /my-plan, and /definitions are the salon-facing
// exceptions to "super-admin-only module" below. /my-features is how the
// salon dashboard itself (sidebar, feature gates) learns what its own plan
// actually includes; /my-plan powers the salon's own Billing page (Settings
// → Billing "Current Plan" card); /definitions is the plain 3-tier catalog
// (read-only, no per-salon data) needed by the Billing page's "Available
// Plans" grid, SubscriptionWall.tsx's expired-subscription screen, AND the
// public marketing landing page's Pricing section
// (components/Landing/Pricing/Pricing.tsx) — all three render all 3 plans,
// not just one salon's tier, so /my-plan's single-tier response isn't
// enough on its own. /definitions is deliberately NOT behind authMiddleware:
// it's public marketing/pricing data (same info the landing page shows
// logged-out visitors) with nothing salon-specific in it. /my-features and
// /my-plan stay authenticated — they always read req.user.salonId from the
// JWT rather than taking a param, so there's no way to query another
// salon's plan through them. All three are registered before the
// router.use() below so they aren't swept into the super-admin-only gate.
router.get("/my-features", authMiddleware, salonPlansController.getMyFeatures);
router.get("/my-plan",      authMiddleware, salonPlansController.getMyPlan);
router.get("/definitions",  salonPlansController.listPlanDefinitions);

// Everything else in this module is super-admin-only — the 3-tier catalog's
// own editing and per-salon overrides are managed exclusively from the
// Plans & Subscriptions admin screen, never by a salon owner directly.
router.use(authMiddleware, superAdminMiddleware);

// Plan definitions — GET is salon-facing (registered above); only editing
// stays super-admin-only.
router.put("/definitions/:tier",                salonPlansController.updatePlanDefinition);
router.post("/definitions/:tier/sync-razorpay",  salonPlansController.syncToRazorpay);

// Salon customizations
router.get("/customizations",                salonPlansController.searchCustomizations);
router.get("/customizations/:salonId",        salonPlansController.getCustomization);
router.put("/customizations/:salonId",        salonPlansController.upsertCustomization);
router.delete("/customizations/:salonId",     salonPlansController.removeCustomization);

// Invoices
router.get("/invoices",              salonPlansController.listInvoices);
router.post("/invoices",             salonPlansController.createInvoice);
router.patch("/invoices/:id/status", salonPlansController.updateInvoiceStatus);

export default router;
