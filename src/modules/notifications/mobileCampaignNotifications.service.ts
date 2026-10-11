import { canSendPush } from "../utils/notif-prefs";
import logger from "../../config/logger";
import { deviceTokensRepository } from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

type CampaignNotice = {
  salonId: string;
  campaignId: string;
  campaignName: string;
  phase: "started" | "ended";
  body: string;
};

/** Sends campaign notices to owner mobile devices without creating a shared notification row or web socket event. */
export const mobileCampaignNotificationsService = {
  async send(notice: CampaignNotice): Promise<void> {
    try {
      if (!(await canSendPush(notice.salonId, "marketingCampaign"))) return;

      // An empty staff-user list selects owner/manager accounts only. The
      // device-token table contains Expo tokens registered by the mobile app.
      const devices = await deviceTokensRepository.findNotificationRecipients(notice.salonId, []);
      const tokens = [...new Set(devices.map(device => device.expo_push_token).filter(Boolean))];
      if (tokens.length === 0) return;

      const notificationId = `mobile-campaign:${notice.campaignId}:${notice.phase}`;
      const result = await pushNotificationService.sendToTokens({
        tokens,
        salonId: notice.salonId,
        title: `Campaign "${notice.campaignName}" ${notice.phase}`,
        body: notice.body,
        data: {
          notification_id: notificationId,
          salon_id: notice.salonId,
          type: "campaign",
          reference_id: notice.campaignId,
          event_key: "marketingCampaign",
          mobile_only: true,
        },
        sound: "default",
        priority: "high",
        channelId: "salonox",
      });
      pushNotificationService.scheduleReceiptCheck(result.receiptReferences);
    } catch (err: any) {
      logger.warn("Mobile campaign notification failed", {
        campaignId: notice.campaignId,
        phase: notice.phase,
        message: err?.message,
      });
    }
  },
};
