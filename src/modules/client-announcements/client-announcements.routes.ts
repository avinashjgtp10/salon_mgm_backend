import { Router, Request, Response, NextFunction } from "express";
import { clientAnnouncementsService } from "./client-announcements.service";
import { platformOtpTemplate } from "./platform-otp-template";

// Mounted inside super-admin.routes.ts (behind authMiddleware + superAdminMiddleware) at /client-announcements.
// Only the setup lives here; templates, campaigns, inbox and insights are the normal Marketing endpoints, which a Super
// Admin request reaches as the platform salon (see authMiddleware and platform-salon.ts).
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };

router.get("/setup", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        return res.json({ success: true, data: await clientAnnouncementsService.getSetup(userId) });
    } catch (err) { return next(err); }
});

router.post("/sync-owners", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await clientAnnouncementsService.syncOwners() });
    } catch (err) { return next(err); }
});

// Redemption OTP template (Super Meta > Automated Messages): status on Meta, and submit it if it is not there yet.
router.get("/otp-template", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await platformOtpTemplate.status() });
    } catch (err) { return next(err); }
});

router.post("/otp-template/submit", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await platformOtpTemplate.submit() });
    } catch (err) { return next(err); }
});

export default router;
