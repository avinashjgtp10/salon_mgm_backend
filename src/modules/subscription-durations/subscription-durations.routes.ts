import { Router, Request, Response, NextFunction } from "express";
import { subscriptionDurationsService } from "./subscription-durations.service";

// Super Admin: duration & pricing options. Mounted inside super-admin.routes.ts, which is already behind
// authMiddleware + superAdminMiddleware, so no auth is repeated here.
const router = Router();

const adminId = (req: Request): string | null => (req as any).user?.userId ?? null;
const wrap = (fn: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
    try { return res.status(status).json({ success: true, data: await fn(req) }); } catch (err) { return next(err); }
};

router.get("/", wrap(() => subscriptionDurationsService.listAll()));
router.post("/", wrap((req) => subscriptionDurationsService.create(req.body, adminId(req)), 201));
router.put("/:id", wrap((req) => subscriptionDurationsService.update(String(req.params.id), req.body)));
router.delete("/:id", wrap((req) => subscriptionDurationsService.remove(String(req.params.id))));

export default router;
