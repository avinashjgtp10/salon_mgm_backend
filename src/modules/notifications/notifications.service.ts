import { notificationsRepository } from "./notifications.repository";
import { getIO } from "../../config/socket";

export const notificationsService = {
  async create(data: { salon_id: string; type: string; title: string; body?: string }) {
    const notification = await notificationsRepository.create(data);
    // Push to all connected clients in this salon room in real-time
    try {
      getIO().to(`salon:${data.salon_id}`).emit("notification", notification);
    } catch {
      // socket not ready — ignore, client will fetch on next load
    }
    return notification;
  },

  async list(salonId: string) {
    return notificationsRepository.listBySalon(salonId, 30);
  },

  async markRead(id: string, salonId: string) {
    return notificationsRepository.markRead(id, salonId);
  },

  async markAllRead(salonId: string) {
    await notificationsRepository.markAllRead(salonId);
  },

  async getUnreadCount(salonId: string) {
    return notificationsRepository.getUnreadCount(salonId);
  },
};
