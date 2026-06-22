import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { superAdminController } from "./super-admin.controller";

const router = Router();

// ── Public: dedicated super-admin login (no JWT required) ────────────────────
router.post("/login", superAdminController.login);

// ── All routes below require valid JWT + super_admin role ─────────────────────
router.use(authMiddleware, superAdminMiddleware);

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

// Salons
router.get("/salons",                       superAdminController.getAllSalons);
router.patch("/salons/:id/status",          superAdminController.setSalonStatus);
router.patch("/salons/:id/onboarding",      superAdminController.forceOnboarding);
router.post("/salons/:id/impersonate",      superAdminController.impersonateSalon);
router.delete("/salons/:id",               superAdminController.deleteSalon);

// Users
router.post("/users/create",                superAdminController.createUser);
router.get("/users",                        superAdminController.getAllUsers);
router.delete("/users/:id",                 superAdminController.deleteUser);
router.patch("/users/:id/status",           superAdminController.setUserStatus);
router.patch("/users/:id/role",             superAdminController.setUserRole);
router.post("/users/:id/reset-password",    superAdminController.resetUserPassword);
router.post("/users/:id/impersonate",       superAdminController.impersonateUser);

// Payments
router.get("/payments",                     superAdminController.getAllPayments);

// Billing
router.get("/subscriptions",                superAdminController.getAllSubscriptions);
router.get("/plans",                        superAdminController.getAllPlans);

export default router;
