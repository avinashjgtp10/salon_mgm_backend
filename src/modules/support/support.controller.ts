import { Request, Response, NextFunction } from "express";
import { supportService } from "./support.service";
import { botQuestionsService } from "../bot/bot-questions.service";
import pool from "../../config/database";
import { getSalonTimezone } from "../../config/salonTimezone";
import { supportNotificationsRepo } from "./support.notifications";

export const supportController = {
  // POST /api/v1/support — salon user submits a ticket
  async submitTicket(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const { subject, category, message, priority = "medium" } = req.body;
      if (!subject?.trim() || !message?.trim()) {
        return res.status(400).json({ success: false, error: { message: "Subject and message are required" } });
      }

      if (!["low", "medium", "high"].includes(priority)) {
        return res.status(400).json({ success: false, error: { message: "Invalid priority" } });
      }
      if (subject.trim().length > 200 || message.trim().length > 5000 || String(category ?? "").length > 50) {
        return res.status(400).json({ success: false, error: { message: "Subject, message or category is too long" } });
      }

      const salon_id = req.user?.salonId;
      const user_id  = req.user?.userId ?? req.user?.id;

      if (!salon_id) {
        return res.status(400).json({ success: false, error: { message: "No salon associated with this account" } });
      }

      const ticket = await supportService.submitTicket({
        salon_id, user_id, subject: subject.trim(),
        category: category ?? "general",
        message:  message.trim(),
        priority,
      });
      return res.status(201).json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // POST /api/v1/support/callback — salon user asks the support team to call them back. Stored as a ticket
  // (category "Callback") for the caller's own salon, so it follows the normal ticket flow.
  async requestCallback(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const salon_id = req.user?.salonId;
      const user_id  = req.user?.userId ?? req.user?.id;
      if (!salon_id) {
        return res.status(400).json({ success: false, error: { message: "No salon associated with this account" } });
      }
      const phone = String(req.body?.phone ?? "").trim();
      if (!/^\+?[0-9][0-9 ()-]{5,19}$/.test(phone)) {
        return res.status(400).json({ success: false, error: { message: "Enter a valid phone number" } });
      }
      const slot = String(req.body?.slot ?? "");
      const now = Date.now();
      let at: Date;
      if (slot === "within_30_min") at = new Date(now + 30 * 60_000);
      else if (slot === "within_1_hour") at = new Date(now + 60 * 60_000);
      else if (slot === "later") {
        at = new Date(String(req.body?.at ?? ""));
        if (Number.isNaN(at.getTime())) {
          return res.status(400).json({ success: false, error: { message: "Choose a date and time for the callback" } });
        }
        if (at.getTime() < now + 5 * 60_000) {
          return res.status(400).json({ success: false, error: { message: "Choose a callback time in the future" } });
        }
        if (at.getTime() > now + 30 * 86_400_000) {
          return res.status(400).json({ success: false, error: { message: "Choose a callback time within the next 30 days" } });
        }
      } else {
        return res.status(400).json({ success: false, error: { message: "Choose when you would like the callback" } });
      }
      const module = String(req.body?.module ?? "").trim() || null;
      if (module && module.length > 50) {
        return res.status(400).json({ success: false, error: { message: "Module name is too long" } });
      }
      const note = String(req.body?.note ?? "").trim();
      if (note.length > 1000) {
        return res.status(400).json({ success: false, error: { message: "Note must be 1000 characters or fewer" } });
      }

      const when = slot === "within_30_min" ? "within 30 minutes"
        : slot === "within_1_hour" ? "within 1 hour"
        : `on ${at.toLocaleString("en-IN", { timeZone: await getSalonTimezone(salon_id), day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`;
      const ticket = await supportService.submitTicket({
        salon_id, user_id,
        subject: "Callback request",
        category: "Callback",
        message: `Please call back ${when} on ${phone}.${module ? `\nModule: ${module}` : ""}${note ? `\n\nNote: ${note}` : ""}`,
        priority: "medium",
        callback: { phone, slot, at, module },
      });
      return res.status(201).json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // GET /api/v1/support/my — salon user views their own tickets
  async getMyTickets(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const user_id  = req.user?.userId ?? req.user?.id;
      const salon_id = req.user?.salonId;
      const tickets  = await supportService.getMyTickets(user_id, salon_id);
      return res.json({ success: true, data: tickets });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id/read — owner marks the support reply as seen
  async markReplyRead(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const user_id  = req.user?.userId ?? req.user?.id;
      const salon_id = req.user?.salonId;
      const ticket = await supportService.markReplyRead(String(req.params.id), user_id, salon_id);
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // GET /api/v1/support — super admin lists ALL tickets
  async getAllTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, priority, search, kind } = req.query as Record<string, string>;
      const tickets = await supportService.getAllTickets({ status, priority, search, kind: kind === "callback" || kind === "ticket" ? kind : undefined });
      return res.json({ success: true, data: tickets });
    } catch (err) { next(err); }
  },

  // GET /api/v1/support/assignees — super admin: who a ticket / callback can be assigned to
  async listAssignees(_req: Request, res: Response, next: NextFunction) {
    try { return res.json({ success: true, data: await supportService.listAssignees() }); } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id/assign — super admin: assign (or unassign with assignee_id null)
  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = req.body?.assignee_id;
      const ticket = await supportService.assign(String(req.params.id), raw ? String(raw) : null);
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // POST /api/v1/support/:id/notes — super admin: add an internal note (never shown to the salon)
  async addNote(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?.userId ?? req.user?.id;
      const author = (await supportService.listAssignees()).find((a: any) => a.id === adminId);
      const ticket = await supportService.addNote(String(req.params.id), String(req.body?.note ?? ""), { id: adminId, name: author?.name ?? "Support" });
      return res.status(201).json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // POST /api/v1/support/admin — super admin raises a ticket for a salon
  async createForSalon(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const { salon_id, subject, category, message, priority = "medium" } = req.body ?? {};
      if (!salon_id) return res.status(400).json({ success: false, error: { message: "Choose a salon" } });
      if (!String(subject ?? "").trim() || !String(message ?? "").trim()) {
        return res.status(400).json({ success: false, error: { message: "Subject and message are required" } });
      }
      if (!["low", "medium", "high"].includes(priority)) return res.status(400).json({ success: false, error: { message: "Invalid priority" } });
      if (String(subject).trim().length > 200 || String(message).trim().length > 5000 || String(category ?? "").length > 50) {
        return res.status(400).json({ success: false, error: { message: "Subject, message or category is too long" } });
      }
      const ticket = await supportService.createForSalon({
        salon_id: String(salon_id), subject: String(subject).trim(), category: String(category ?? "General"), message: String(message).trim(), priority,
      });
      return res.status(201).json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // GET /api/v1/support/notifications — the support team's bell
  async listNotifications(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try { return res.json({ success: true, data: await supportNotificationsRepo.list(req.user?.userId ?? req.user?.id) }); } catch (err) { next(err); }
  },
  async markNotificationRead(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const ok = await supportNotificationsRepo.markRead(req.user?.userId ?? req.user?.id, String(req.params.id));
      if (!ok) return res.status(404).json({ success: false, error: { message: "Notification not found" } });
      return res.json({ success: true, data: { id: String(req.params.id) } });
    } catch (err) { next(err); }
  },
  async markAllNotificationsRead(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try { await supportNotificationsRepo.markAllRead(req.user?.userId ?? req.user?.id); return res.json({ success: true, data: {} }); } catch (err) { next(err); }
  },

  // GET /api/v1/support/stats — super admin ticket stats
  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await supportService.getStats();
      return res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  },

  // GET /api/v1/support/attention — everything the Super Admin's notification badges, bell
  // and toast need in ONE round trip (it used to be three separate requests every poll):
  // the ticket stats, the chatbot question stats and the newest unanswered chatbot questions.
  async getAttention(_req: Request, res: Response, next: NextFunction) {
    try {
      const [supportStats, botStats, unanswered] = await Promise.all([
        supportService.getStats(),
        botQuestionsService.stats(),
        botQuestionsService.list({ answered: "unanswered", page: 1, limit: 5 }),
      ]);
      // Open Client Requirements (Issue Tracker) for the sidebar badge; optional table, so never fail the call.
      let openIssues = 0;
      try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM client_requirements WHERE status <> 'completed'`);
        openIssues = rows[0]?.n ?? 0;
      } catch { /* requirements tables not migrated */ }
      return res.json({
        success: true,
        data: {
          open_issues: openIssues,
          support_stats: supportStats,
          chatbot_stats: botStats,
          recent_chatbot: unanswered.rows,
        },
      });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id/reply — super admin replies
  async replyToTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const { reply } = req.body;
      if (!reply?.trim()) {
        return res.status(400).json({ success: false, error: { message: "Reply text is required" } });
      }
      if (reply.trim().length > 2000) {
        return res.status(400).json({ success: false, error: { message: "Reply must be 2000 characters or fewer" } });
      }
      const ticket = await supportService.replyToTicket(String(req.params.id), reply.trim());
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id — super admin edits subject / category / message / priority
  async updateTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const { subject, category, message, priority } = req.body ?? {};
      const ticket = await supportService.updateTicket(String(req.params.id), { subject, category, message, priority });
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/support/:id — super admin deletes a ticket
  async deleteTicket(req: Request, res: Response, next: NextFunction) {
    try {
      await supportService.deleteTicket(String(req.params.id));
      return res.json({ success: true, data: { id: String(req.params.id) } });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id/status — super admin changes status
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const ticket = await supportService.updateStatus(String(req.params.id), status);
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },
};
