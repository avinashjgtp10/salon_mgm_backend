import { Router, Request, Response, NextFunction } from "express";
import { modulePlansService } from "./module-plans.service";

// Mounted inside super-admin.routes.ts, which is already behind
// authMiddleware + superAdminMiddleware — no auth is repeated here.
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await modulePlansService.list() });
    } catch (err) { return next(err); }
});

router.put("/:slug", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        const data = await modulePlansService.set(req.params.slug, req.body?.locked, userId);
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

export default router;
