import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { mobileOwnerController } from "./mobileOwner.controller";

// Owner/admin endpoints for settings that exist only in the SalonOX mobile
// app, mounted at /api/v1/mobile/owner. The web app has no UI for these and
// they never change web behaviour.
const router = Router();

router.use(authMiddleware, roleMiddleware("salon_owner", "admin"));

// Per-staff "Calendar & Quick Sale access" switch — see mobileCalendarAccess.ts.
router.get("/staff/calendar-access", mobileOwnerController.listCalendarAccess);
router.get("/staff/:staffId/calendar-access", mobileOwnerController.getCalendarAccess);
router.put("/staff/:staffId/calendar-access", mobileOwnerController.setCalendarAccess);

export default router;
