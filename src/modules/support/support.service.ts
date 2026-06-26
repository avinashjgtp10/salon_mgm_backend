import { supportRepo } from "./support.repository";
import { emailService } from "../utils/email.service";

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
      console.error("Failed to send support ticket notification:", err?.message ?? err);
    });

    return notificationTicket;
  },

  async getMyTickets(userId: string, salonId: string) {
    return supportRepo.getTicketsByUser(userId, salonId);
  },

  async getAllTickets(filters: { status?: string; priority?: string; search?: string }) {
    return supportRepo.getAllTickets(filters);
  },

  async replyToTicket(id: string, reply: string) {
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new Error("Ticket not found");
    return supportRepo.replyToTicket(id, reply);
  },

  async updateStatus(id: string, status: string) {
    const allowed = ["open", "in_progress", "resolved", "closed"];
    if (!allowed.includes(status)) throw new Error("Invalid status");
    const ticket = await supportRepo.getTicketById(id);
    if (!ticket) throw new Error("Ticket not found");
    return supportRepo.updateTicketStatus(id, status);
  },

  async getStats() {
    return supportRepo.getStats();
  },
};
