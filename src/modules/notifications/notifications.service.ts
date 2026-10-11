import { notificationsRepository } from "./notifications.repository";
import { getIO, salonRoom, mobileStaffUserRoom } from "../../config/socket";
import { canSendPush } from "../utils/notif-prefs";
import logger from "../../config/logger";
import { deviceTokensRepository } from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

import { appointmentStaffNotifications } from "./staffNotificationScope";
import type { Notification } from "./notifications.repository";

const ANDROID_NOTIFICATION_CHANNEL_ID = "salonox";

type CreateNotificationData = {
  salon_id: string;
  reference_id?: string;
  appointment_id?: string;
  type: string;
  title: string;
  body?: string;
  event_key?: string;
  scheduled_at?: string;
  product_id?: string;
  branch_id?: string;
  alert_status?: string;
  spotlight_feature_id?: string;
  contact_phone?: string;
};

type CreateNotificationOptions = {
  rejectOnPushFailure?: boolean;
  deduplicate?: boolean;
  persistWhenPushDisabled?: boolean;
};

export const notificationsService = {
  async create(data: CreateNotificationData, options: CreateNotificationOptions = {}) {
    logger.info("Notification create started", {
      salonId: data.salon_id,
      type: data.type,
      eventKey: data.event_key,
    });

    const fallbackEvents: Record<string, string> = {
      appointment: "newAppointment",
      payment: "newPayment",
      payment_complete: "newPayment",
      payment_completed: "newPayment",
      product_audit: "productAudit",
      inventory_audit: "productAudit",
    };
    const preferenceEvent = data.event_key ?? fallbackEvents[data.type] ?? "otherUpdates";
    const allowed = await canSendPush(data.salon_id, preferenceEvent);
    if (!allowed && !options.persistWhenPushDisabled) {
      logger.info("Notification skipped by push preference", { salonId: data.salon_id, eventKey: preferenceEvent });
      return null;
    }
    const appointmentId = data.type === "appointment" ? data.reference_id : data.appointment_id;
    const staffMessages = await appointmentStaffNotifications(data.salon_id, appointmentId);
    const recipientUserIds = staffMessages.map(item => item.userId);
    const createData = {
      reference_id: data.reference_id,
      recipient_user_ids: recipientUserIds,
      salon_id: data.salon_id,
      type: data.type,
      title: data.title,
      body: data.body,
      product_id: data.product_id,
      branch_id: data.branch_id,
      alert_status: data.alert_status,
      spotlight_feature_id: data.spotlight_feature_id,
      contact_phone: data.contact_phone,
    };
    const notification = options.deduplicate
      ? await notificationsRepository.createOnce(createData)
      : await notificationsRepository.create(createData);
    if (!notification) return null;
    logger.info("Notification DB row created", {
      notificationId: notification.id,
      salonId: notification.salon_id,
      type: notification.type,
    });

    try {
      // Managers get every notification; staff only those addressed to them.
      getIO().to(salonRoom(data.salon_id)).emit(
        "notification",
        data.scheduled_at ? { ...notification, scheduled_at: data.scheduled_at } : notification
      );
      for (const message of staffMessages) {
        getIO().to(mobileStaffUserRoom(message.userId)).emit("notification", {
          ...notification, title: message.title, body: message.body,
          type: "appointment", reference_id: appointmentId,
          recipient_user_ids: [message.userId], contact_phone: null,
          ...(data.scheduled_at ? { scheduled_at: data.scheduled_at } : {}),
        });
      }
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

    if (!allowed) return notification;

    let pushStage = "device_token_lookup";
    try {
      logger.info("Device-token lookup started", {
        notificationId: notification.id,
        salonId: notification.salon_id,
      });

      const devices = await deviceTokensRepository.findNotificationRecipients(data.salon_id, recipientUserIds);
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
        const staffByUser = new Map(staffMessages.map(message => [message.userId, message]));
        const groups = new Map<string, typeof devices>();
        for (const device of devices) {
          const key = staffByUser.has(device.user_id) ? device.user_id : "owners";
          const group = groups.get(key) ?? [];
          group.push(device);
          groups.set(key, group);
        }
        for (const [key, group] of groups) {
          const staffMessage = staffByUser.get(key);
          pushStage = "expo_send";
          logger.info("Expo send started", {
            notificationId: notification.id,
            salonId: notification.salon_id,
            tokenCount: tokens.length,
          });

          const result = await pushNotificationService.sendToTokens({
            tokens: [...new Set(group.map(device => device.expo_push_token).filter(Boolean))],
            notificationId: notification.id,
            salonId: notification.salon_id,
            title: staffMessage?.title ?? data.title,
            body: staffMessage?.body ?? data.body,
            data: {
              notification_id: notification.id,
              salon_id: notification.salon_id,
              type: staffMessage ? "appointment" : notification.type,
              reference_id: staffMessage ? appointmentId : data.reference_id,
              recipient_user_ids: staffMessage ? [staffMessage.userId] : recipientUserIds,
              event_key: preferenceEvent,
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
        }
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

  async list(salonId: string, staffUserId?: string) {
    const notifications = await notificationsRepository.listBySalon(salonId, 30, staffUserId);
    if (!staffUserId) return notifications;
    const projected = await Promise.all(notifications.map(notification => staffView(notification, staffUserId)));
    return projected.filter((notification): notification is Notification => notification !== null);
  },

  // "All Branches" aggregate — same 30-row cap as the single-salon list,
  // merged and re-sorted across every salon rather than 30 per salon, so it
  // reads the same way ("most recent 30 across everything I manage") rather
  // than ballooning with the number of branches.
  async listForSalons(salonIds: string[]) {
    return notificationsRepository.listBySalons(salonIds, 30);
  },

  async markRead(id: string, salonId: string, staffUserId?: string) {
    const notification = await notificationsRepository.markRead(id, salonId, staffUserId);
    return notification && staffUserId ? staffView(notification, staffUserId) : notification;
  },

  async markAllRead(salonId: string, staffUserId?: string) {
    await notificationsRepository.markAllRead(salonId, staffUserId);
  },

  async markAllReadForSalons(salonIds: string[]) {
    await notificationsRepository.markAllReadForSalons(salonIds);
  },

  async getUnreadCount(salonId: string, staffUserId?: string) {
    return notificationsRepository.getUnreadCount(salonId, staffUserId);
  },

  async getUnreadCountForSalons(salonIds: string[]) {
    return notificationsRepository.getUnreadCountForSalons(salonIds);
  },
};

// Older stored rows contain owner text too. Never return that text to staff.
async function staffView(notification: Notification, userId: string): Promise<Notification | null> {
  if (notification.type !== "appointment") return notification;
  const messages = await appointmentStaffNotifications(notification.salon_id, notification.reference_id ?? undefined);
  const message = messages.find(item => item.userId === userId);
  return message ? {
    ...notification, title: message.title, body: message.body,
    recipient_user_ids: [userId], contact_phone: null,
  } : null;
}
