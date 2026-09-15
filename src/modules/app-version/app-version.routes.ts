import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { appVersionController } from "./app-version.controller";

const router = Router();

// No authMiddleware — the mobile app runs its update check on cold start,
// before login (see AppUpdateSetup in the mobile root layout). A force update
// exists precisely for clients too old to authenticate, so gating this behind a
// token would stop it firing when it matters most. Read-only: the handler takes
// platform/environment/currentVersion from the query string and performs no
// mutation, so nothing is exposed beyond the published version configuration.
router.get("/version", appVersionController.getVersion);

// Super Admin only — managing the global configuration. Same posture as
// deployment-announcements: global reads for clients, super-admin writes.
router.get("/versions", authMiddleware, superAdminMiddleware, appVersionController.list);
router.put("/version", authMiddleware, superAdminMiddleware, appVersionController.upsert);
router.delete("/version", authMiddleware, superAdminMiddleware, appVersionController.remove);

export default router;
