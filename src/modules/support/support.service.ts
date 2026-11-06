import { randomUUID } from "crypto";
import logger from '../../config/logger';
import { supportRepo, publicTicket } from "./support.repository";
import { emailService } from "../utils/email.service";
import { AppError } from "../../middleware/error.middleware";
import { notifySupport } from "./support.notifications";

// The support team's view of one ticket: the same row the list shows (salon, submitter, assignee), with internal notes.
const adminTicket = async (id: string) => (await supportRepo.getAllTickets({ id }))[0] ?? null;

export const supportService = {
  async submitTicket(data: {
    salon_id: string;
    user_id: string;
    subject: string;
    category: string;
    message: string;
    priority: string;
    callback?: { phone: string; slot: string; at: Date; module: string | null };
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
    void notifySupport(notificationTicket, { kind: "new" });

    return publicTicket(notificationTicket);
  },

  async getMyTickets(userId: string, salonId: string) {
    return supportRepo.getTicketsByUser(userId, salonId);
  },

  async markReplyRead(id: string, userId: string, salonId: string) {
    const ticket = await supportRepo.markReplyRead(id, userId, salonId);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    return ticket;
  },

  async getAllTickets(filters: { status?: string; priority?: string; search?: string; kind?: "ticket" | "callback" }) {
    return supportRepo.getAllTickets(filters);
  },

  async replyToTicket(id: string, reply: string) {
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    const updated = await supportRepo.replyToTicket(id, reply);
    void notifySupport(updated ?? ticket, { kind: "reply" });
    // Replying moves an open ticket to in progress (see the repository): that is a status change too.
    if (ticket.status === "open" && updated?.status === "in_progress") void notifySupport(updated, { kind: "status", status: "in_progress" });
    return updated;
  },

  async updateStatus(id: string, status: string) {
    const allowed = ["open", "in_progress", "resolved", "closed"];
    if (!allowed.includes(status)) throw new AppError(400, "Invalid status", "VALIDATION_ERROR");
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    const updated = await supportRepo.updateTicketStatus(id, status);
    if (ticket.status !== status) void notifySupport(updated ?? ticket, { kind: "status", status });
    return updated;
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

  // ── Support team: assignment, internal notes, tickets raised on a salon's behalf ──

  listAssignees() {
    return supportRepo.listAssignees();
  },

  async assign(id: string, assigneeId: string | null) {
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    let assigneeName = "";
    if (assigneeId) {
      const assignee = (await supportRepo.listAssignees()).find((a: any) => a.id === assigneeId);
      if (!assignee) throw new AppError(400, "Choose a support team member to assign this to", "VALIDATION_ERROR");
      assigneeName = assignee.name;
    }
    await supportRepo.assignTicket(id, assigneeId);
    const updated = await adminTicket(id);
    if (assigneeId && ticket.assigned_to !== assigneeId) void notifySupport(updated ?? ticket, { kind: "assigned", assignee: assigneeName });
    return updated;
  },

  async addNote(id: string, note: string, author: { id: string; name: string }) {
    const text = note.trim();
    if (!text) throw new AppError(400, "Write a note first", "VALIDATION_ERROR");
    if (text.length > 2000) throw new AppError(400, "A note must be 2000 characters or fewer", "VALIDATION_ERROR");
    const ok = await supportRepo.addInternalNote(id, { id: randomUUID(), author_id: author.id, author_name: author.name, note: text, at: new Date().toISOString() });
    if (!ok) throw new AppError(404, "Ticket not found", "NOT_FOUND");
    return adminTicket(id);
  },

  // The support team raises a ticket for a salon. It belongs to the salon's owner, so the owner sees it under My Requests too.
  async createForSalon(data: { salon_id: string; subject: string; category: string; message: string; priority: string }) {
    const ownerId = await supportRepo.getSalonOwner(data.salon_id);
    if (!ownerId) throw new AppError(404, "Salon not found", "NOT_FOUND");
    const ticket = await supportRepo.createTicket({ ...data, user_id: ownerId });
    const full = await adminTicket(ticket.id);
    void notifySupport(full ?? ticket, { kind: "new" });
    return full;
  },

  adminTicket,
};
