import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { clientActivityRepository, type StatusFilter } from "./client-activity.repository";

// Mounted under /api/v1/super-admin/client-activity - the parent router already requires a valid JWT
// AND the super_admin role (super-admin.routes.ts), so none of this is reachable by a client/salon user.
const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// Date range: a preset (days=7|14|30, rolling up to now) or a custom from/to (ISO dates or timestamps).
function parseRange(q: Request["query"]): { from: Date; to: Date } {
  const to = q.to ? new Date(String(q.to)) : new Date();
  if (isNaN(to.getTime())) throw new AppError(400, "to is not a valid date", "VALIDATION_ERROR");
  if (q.from) {
    const from = new Date(String(q.from));
    if (isNaN(from.getTime())) throw new AppError(400, "from is not a valid date", "VALIDATION_ERROR");
    if (from > to) throw new AppError(400, "from must be before to", "VALIDATION_ERROR");
    if (to.getTime() - from.getTime() > 366 * DAY_MS) throw new AppError(400, "The date range can be at most one year", "VALIDATION_ERROR");
    return { from, to };
  }
  const days = Math.min(365, Math.max(1, Number(q.days) || 7));
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

const platformOf = (v: unknown): "web" | "app" | undefined => (v === "web" || v === "app" ? v : undefined);
const num = (v: unknown, d: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v)) || d));

// GET /client-activity?days=7|14|30  or  ?from=&to=   &platform=web|app &status=online|active|inactive &search= &page= &limit=
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req.query);
    const status = ["online", "active", "inactive"].includes(String(req.query.status)) ? (req.query.status as StatusFilter) : undefined;
    const data = await clientActivityRepository.list({
      from, to, platform: platformOf(req.query.platform), status,
      search: String(req.query.search || "").trim() || undefined,
      page: num(req.query.page, 1, 1, 100000), limit: num(req.query.limit, 20, 1, 100),
    });
    return sendSuccess(res, 200, { ...data, range: { from, to } }, "Client activity fetched");
  } catch (e) { return next(e); }
});

// GET /client-activity/:userId  -> the account, its Web + App summaries, and its event history
router.get("/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new AppError(400, "Invalid user id", "VALIDATION_ERROR");
    const { from, to } = parseRange(req.query);
    const user = await clientActivityRepository.userHeader(userId);
    if (!user) throw new AppError(404, "Account not found", "NOT_FOUND");
    const [platforms, events] = await Promise.all([
      clientActivityRepository.userPlatforms(userId, from, to),
      clientActivityRepository.userEvents(userId, {
        from, to, platform: platformOf(req.query.platform), page: num(req.query.page, 1, 1, 100000), limit: num(req.query.limit, 30, 1, 100),
      }),
    ]);
    return sendSuccess(res, 200, { user, platforms, events: events.items, total: events.total, range: { from, to } }, "Client activity history fetched");
  } catch (e) { return next(e); }
});

export default router;
