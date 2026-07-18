import { notificationsRepository } from "./notifications.repository";
import logger from "../../config/logger";
import { emitSalonEvent } from "../utils/realtime.util";
import { deviceTokensRepository } from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

export const notificationsService = {
  async create(data: { salon_id: string; type: string; title: string; body?: string }) {
    const notification = await notificationsRepository.create(data);
    emitSalonEvent("notifications:new", data.salon_id, notification.id, "created", notification);

    try {
      const deviceTokens = await deviceTokensRepository.getSalonTokens(data.salon_id);
      const tokens = deviceTokens.map((deviceToken) => deviceToken.expo_push_token);

      if (tokens.length > 0) {
        await pushNotificationService.sendToTokens({
          tokens,
          title: data.title,
          body: data.body,
          data: {
            notification_id: notification.id,
            salon_id: notification.salon_id,
            type: notification.type,
          },
        });
      }
    } catch (err: any) {
      logger.warn("Expo push notification failed after notification creation", {
        salonId: data.salon_id,
        notificationId: notification.id,
        message: err?.message,
      });
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
