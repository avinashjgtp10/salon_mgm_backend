import { notificationsRepository } from "./notifications.repository";
import { getIO } from "../../config/socket";
import { canSendPush } from "../utils/notif-prefs";
import logger from "../../config/logger";
import { deviceTokensRepository } from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

const ANDROID_NOTIFICATION_CHANNEL_ID = "salonox";

type CreateNotificationData = {
  salon_id: string;
  type: string;
  title: string;
  body?: string;
  event_key?: string;
  scheduled_at?: string;
};

type CreateNotificationOptions = {
  rejectOnPushFailure?: boolean;
};

export const notificationsService = {
  async create(data: CreateNotificationData, options: CreateNotificationOptions = {}) {
    logger.info("Notification create started", {
      salonId: data.salon_id,
      type: data.type,
      eventKey: data.event_key,
    });

    if (data.event_key) {
      const allowed = await canSendPush(data.salon_id, data.event_key);
      logger.info("Notification push preference result", {
        salonId: data.salon_id,
        type: data.type,
        eventKey: data.event_key,
        allowed,
      });

      if (!allowed) {
        logger.info("Notification skipped by push preference", {
          salonId: data.salon_id,
          eventKey: data.event_key,
          type: data.type,
        });
        return null;
      }
    } else {
      logger.info("Notification push preference result", {
        salonId: data.salon_id,
        type: data.type,
        allowed: true,
        reason: "no_event_key",
      });
    }

    const notification = await notificationsRepository.create(data);
    logger.info("Notification DB row created", {
      notificationId: notification.id,
      salonId: notification.salon_id,
      type: notification.type,
    });

    try {
      getIO().to(`salon:${data.salon_id}`).emit(
        "notification",
        data.scheduled_at ? { ...notification, scheduled_at: data.scheduled_at } : notification
      );
      logger.info("Socket notification emitted", {
        notificationId: notification.id,
        salonId: notification.salon_id,
      });
    } catch (err: any) {
      logger.warn("Notification socket emit failed", {
        notificationId: notification.id,
        salonId: notification.salon_id,
        message: err?.message,
      });
    }

    let pushStage = "device_token_lookup";
    try {
      logger.info("Device-token lookup started", {
        notificationId: notification.id,
        salonId: notification.salon_id,
      });

      const devices = await deviceTokensRepository.findBySalon(data.salon_id);
      const tokens = Array.from(
        new Set(devices.map((device) => device.expo_push_token).filter(Boolean))
      );

      logger.info("Device-token lookup completed", {
        notificationId: notification.id,
        salonId: data.salon_id,
        deviceRows: devices.length,
        selectedTokens: tokens.length,
      });

      if (tokens.length > 0) {
        pushStage = "expo_send";
        logger.info("Expo send started", {
          notificationId: notification.id,
          salonId: notification.salon_id,
          tokenCount: tokens.length,
        });

        const result = await pushNotificationService.sendToTokens({
          tokens,
          notificationId: notification.id,
          salonId: notification.salon_id,
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

        pushStage = "expo_send_result";
        logger.info("Expo send result", {
          notificationId: notification.id,
          salonId: notification.salon_id,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          receiptCount: result.receiptReferences.length,
          removedTokenCount: result.removedTokens.length,
        });

        pushStage = "receipt_schedule";
        pushNotificationService.scheduleReceiptCheck(result.receiptReferences);
        logger.info("Receipt records created and scheduled", {
          notificationId: notification.id,
          salonId: notification.salon_id,
          receiptCount: result.receiptReferences.length,
        });
      } else {
        logger.info("Expo send skipped because no device tokens were selected", {
          notificationId: notification.id,
          salonId: notification.salon_id,
        });
      }

      logger.info("Notification push flow completed", {
        notificationId: notification.id,
        salonId: notification.salon_id,
      });
    } catch (err: any) {
      logger.error("Notification push flow failed after DB row creation", {
        notificationId: notification.id,
        salonId: notification.salon_id,
        stage: pushStage,
        message: err?.message,
        stack: err?.stack,
      });

      if (options.rejectOnPushFailure) {
        throw err;
      }
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
