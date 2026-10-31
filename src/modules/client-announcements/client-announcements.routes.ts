import { Router, Request, Response, NextFunction } from "express";
import { clientAnnouncementsService } from "./client-announcements.service";

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

export default router;
