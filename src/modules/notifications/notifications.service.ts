import { notificationsRepository } from "./notifications.repository";
import { getIO } from "../../config/socket";
import { canSendPush } from "../utils/notif-prefs";
import logger from "../../config/logger";
import { deviceTokensRepository } from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

const ANDROID_NOTIFICATION_CHANNEL_ID = "salonox";

export const notificationsService = {
  async create(data: { salon_id: string; type: string; title: string; body?: string; event_key?: string }) {
    // `event_key` matches Settings → Notifications' per-event keys (newAppointment,
    // newClient, ...). Omitted by call sites with no matching settings toggle —
    // those always fire, same as before. When present, this is the single choke
    // point every notification-creating call site goes through, so gating here
    // covers both the bell/DB row and the live push in one place instead of
    // needing every caller to check for itself.
    if (data.event_key) {
      const allowed = await canSendPush(data.salon_id, data.event_key);
      if (!allowed) return null;
    }
    const notification = await notificationsRepository.create(data);

    // Push to all connected clients in this salon room in real-time
    try {
      getIO().to(`salon:${data.salon_id}`).emit("notification", notification);
    } catch (err: any) {
      // socket not ready — ignore, client will fetch on next load
      logger.warn("Notification socket emit failed", {
        notificationId: notification.id,
        salonId: notification.salon_id,
        message: err?.message,
      });
    }

    // A persisted token is active in the current schema. Invalid and
    // unregistered Expo tokens are removed by pushNotificationService.
    try {
      const devices = await deviceTokensRepository.getSalonTokens(data.salon_id);
      const tokens = Array.from(
        new Set(devices.map((device) => device.expo_push_token).filter(Boolean))
      );

      if (tokens.length > 0) {
        const result = await pushNotificationService.sendToTokens({
          tokens,
          title: data.title,
          body: data.body,
          data: {
            notification_id: notification.id,
            salon_id: notification.salon_id,
            type: notification.type,
          },
          sound: "default",
          priority: "high",
          channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
        });

        pushNotificationService.scheduleReceiptCheck(result.receiptReferences);
      }
    } catch (err: any) {
      // Push delivery is best-effort and must never roll back the DB notification.
      logger.error("Expo push notification failed after notification creation", {
        notificationId: notification.id,
        salonId: notification.salon_id,
        message: err?.message,
        stack: err?.stack,
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
