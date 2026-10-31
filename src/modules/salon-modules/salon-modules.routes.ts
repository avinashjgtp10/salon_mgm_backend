import { Router, Request, Response, NextFunction } from "express";
import { salonModulesService } from "./salon-modules.service";

// Mounted inside super-admin.routes.ts, which is already behind
// authMiddleware + superAdminMiddleware — no auth is repeated here.
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };

router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const data = await salonModulesService.searchSalons(q);
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

router.get("/:salonId", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await salonModulesService.getForSalon(String(req.params.salonId));
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

router.put("/:salonId", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const changedBy = req.user?.userId;
        if (!changedBy) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        const data = await salonModulesService.setForSalon(String(req.params.salonId), req.body?.locked, changedBy);
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

export default router;
