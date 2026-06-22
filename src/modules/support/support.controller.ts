import { Request, Response, NextFunction } from "express";
import { supportService } from "./support.service";

export const supportController = {
  // POST /api/v1/support — salon user submits a ticket
  async submitTicket(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const { subject, category, message, priority = "medium" } = req.body;
      if (!subject?.trim() || !message?.trim()) {
        return res.status(400).json({ success: false, error: { message: "Subject and message are required" } });
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

  // PATCH /api/v1/support/:id/reply — super admin replies
  async replyToTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const { reply } = req.body;
      if (!reply?.trim()) {
        return res.status(400).json({ success: false, error: { message: "Reply text is required" } });
      }
      const ticket = await supportService.replyToTicket(req.params.id, reply.trim());
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/support/:id/status — super admin changes status
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const ticket = await supportService.updateStatus(req.params.id, status);
      return res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  },
};
