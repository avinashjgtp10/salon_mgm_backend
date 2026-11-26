import { Router, Request, Response, NextFunction } from "express";
import { billingIssuesService } from "./billing-issues";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
const router = Router();
const wrap = (fn: (req: any) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, data: await fn(req) }); } catch (err) { return next(err); }
};

router.get("/", wrap((req) => billingIssuesService.list(req.query.status === "resolved" ? "resolved" : "open")));
router.post("/:id/resolve", wrap((req) => billingIssuesService.resolve(String(req.params.id), req.user.userId, req.body?.note)));
router.post("/:id/retry-stop", wrap((req) => billingIssuesService.retryStop(String(req.params.id), req.user.userId)));

export default router;
