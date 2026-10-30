import { Router, Request, Response, NextFunction } from "express";
import { paymentTrackingService as svc } from "./payment-tracking.service";
import { subscriptionPaymentsService as subs } from "./subscription-payments.service";

// Mounted inside super-admin.routes.ts at /api/v1/super-admin/payment-tracking, which is already behind authMiddleware + superAdminMiddleware.
const router = Router();
type AuthedRequest = Request & { user?: { userId: string } };
const uid = (req: AuthedRequest) => req.user?.userId ?? null;

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => { try { await fn(req as AuthedRequest, res); } catch (e) { next(e); } };

router.get("/summary", wrap(async (_req, res) => { res.json({ success: true, data: await svc.summary() }); }));

// Razorpay subscription payments, read from the subscription tables (read-only).
router.get("/subscription-payments", wrap(async (req, res) => {
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    res.json({ success: true, data: await subs.list({ search: s(req.query.search), plan: s(req.query.plan), status: s(req.query.status), method: s(req.query.method), from: s(req.query.from), to: s(req.query.to) }) });
}));
router.get("/subscription-payments/:salonId", wrap(async (req, res) => { res.json({ success: true, data: await subs.detail(String(req.params.salonId)) }); }));

// kind = customer | website
router.get("/receivables", wrap(async (req, res) => { res.json({ success: true, data: await svc.listReceivables(req.query.kind, req.query) }); }));
router.post("/receivables", wrap(async (req, res) => { res.status(201).json({ success: true, data: await svc.createReceivable(req.body, uid(req)) }); }));
router.patch("/receivables/:id", wrap(async (req, res) => { res.json({ success: true, data: await svc.updateReceivable(String(req.params.id), req.body) }); }));
router.get("/receivables/:id/payments", wrap(async (req, res) => { res.json({ success: true, data: await svc.history(String(req.params.id)) }); }));
router.post("/receivables/:id/payments", wrap(async (req, res) => { res.status(201).json({ success: true, data: await svc.addPayment(String(req.params.id), req.body, uid(req)) }); }));
router.patch("/receivables/:id/payments/:paymentId", wrap(async (req, res) => {
    res.json({ success: true, data: await svc.updatePayment(String(req.params.id), String(req.params.paymentId), req.body) });
}));
router.delete("/receivables/:id/payments/:paymentId", wrap(async (req, res) => {
    res.json({ success: true, data: await svc.voidPayment(String(req.params.id), String(req.params.paymentId), uid(req)) });
}));

router.get("/money-added", wrap(async (req, res) => { res.json({ success: true, data: await svc.listMoneyAdded(req.query) }); }));
router.post("/money-added", wrap(async (req, res) => { res.status(201).json({ success: true, data: await svc.addMoney(req.body, uid(req)) }); }));
router.patch("/money-added/:id", wrap(async (req, res) => { res.json({ success: true, data: await svc.updateMoney(String(req.params.id), req.body) }); }));
router.delete("/money-added/:id", wrap(async (req, res) => { await svc.voidMoney(String(req.params.id), uid(req)); res.json({ success: true, data: null }); }));

router.get("/ledger", wrap(async (req, res) => { res.json({ success: true, data: await svc.ledger(req.query) }); }));

export default router;
