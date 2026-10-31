import logger from '../../config/logger';
import { supportRepo } from "./support.repository";
import { emailService } from "../utils/email.service";
import { AppError } from "../../middleware/error.middleware";

export const supportService = {
  async submitTicket(data: {
    salon_id: string;
    user_id: string;
    subject: string;
    category: string;
    message: string;
    priority: string;
  }) {
    const ticket = await supportRepo.createTicket(data);
    const ticketDetails = await supportRepo.getTicketById(ticket.id);
    const notificationTicket = ticketDetails ?? ticket;

    void emailService.sendSupportTicketCreatedEmail({
      ticketId: notificationTicket.id,
      subject: notificationTicket.subject,
      category: notificationTicket.category,
      message: notificationTicket.message,
      priority: notificationTicket.priority,
      salonName: notificationTicket.salon_name,
      submitterName: notificationTicket.submitter_name,
      submitterEmail: notificationTicket.submitter_email,
      createdAt: notificationTicket.created_at,
    }).catch((err: any) => {
      logger.error("Failed to send support ticket notification:", err?.message ?? err);
    });

    return notificationTicket;
  },

  async getMyTickets(userId: string, salonId: string) {
    return supportRepo.getTicketsByUser(userId, salonId);
  },

  async markReplyRead(id: string, userId: string, salonId: string) {
    const ticket = await supportRepo.markReplyRead(id, userId, salonId);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    return ticket;
  },

  async getAllTickets(filters: { status?: string; priority?: string; search?: string }) {
    return supportRepo.getAllTickets(filters);
  },

  async replyToTicket(id: string, reply: string) {
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    return supportRepo.replyToTicket(id, reply);
  },

  async updateStatus(id: string, status: string) {
    const allowed = ["open", "in_progress", "resolved", "closed"];
    if (!allowed.includes(status)) throw new AppError(400, "Invalid status", "VALIDATION_ERROR");
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    return supportRepo.updateTicketStatus(id, status);
  },

  async updateTicket(id: string, data: { subject?: string; category?: string; message?: string; priority?: string }) {
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    const subject = (data.subject ?? ticket.subject).trim();
    const message = (data.message ?? ticket.message).trim();
    const category = (data.category ?? ticket.category).trim();
    const priority = data.priority ?? ticket.priority;
    if (!subject) throw new AppError(400, "Subject is required", "VALIDATION_ERROR");
    if (!message) throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    if (subject.length > 200 || message.length > 5000 || category.length > 50) {
      throw new AppError(400, "Subject, message or category is too long", "VALIDATION_ERROR");
    }
    if (!["low", "medium", "high"].includes(priority)) throw new AppError(400, "Invalid priority", "VALIDATION_ERROR");
    return supportRepo.updateTicketDetails(id, { subject, category, message, priority });
  },

  async deleteTicket(id: string) {
    const deleted = await supportRepo.deleteTicket(id);
    if (!deleted) throw new AppError(404, "Ticket not found", "NOT_FOUND");
  },

  async getStats() {
    return supportRepo.getStats();
  },
};
