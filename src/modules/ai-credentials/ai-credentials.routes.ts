import { Router, Request, Response, NextFunction } from "express";
import { aiCredentialsService } from "./ai-credentials.service";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
// The token is returned ONLY by GET /:salonId/token (super admin, to show and copy it); no other route returns it.
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };

router.get("/:salonId", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await aiCredentialsService.getStatus(String(req.params.salonId)) });
    } catch (err) { return next(err); }
});

// The only place the full token is ever returned, and only to a super admin.
router.get("/:salonId/token", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await aiCredentialsService.reveal(String(req.params.salonId), req.user?.userId ?? "") });
    } catch (err) { return next(err); }
});

router.put("/:salonId", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const changedBy = req.user?.userId;
        if (!changedBy) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        return res.json({ success: true, data: await aiCredentialsService.set(String(req.params.salonId), req.body ?? {}, changedBy) });
    } catch (err) { return next(err); }
});

router.delete("/:salonId", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const changedBy = req.user?.userId;
        if (!changedBy) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        return res.json({ success: true, data: await aiCredentialsService.clear(String(req.params.salonId), changedBy) });
    } catch (err) { return next(err); }
});

export default router;
