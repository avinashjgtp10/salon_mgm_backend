import { Request, Response, NextFunction } from "express";
import { supportService } from "./support.service";
import { botQuestionsService } from "../bot/bot-questions.service";
import pool from "../../config/database";

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
      const { status, priority, search } = req.query as Record<string, string>;
      const tickets = await supportService.getAllTickets({ status, priority, search });
      return res.json({ success: true, data: tickets });
    } catch (err) { next(err); }
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
