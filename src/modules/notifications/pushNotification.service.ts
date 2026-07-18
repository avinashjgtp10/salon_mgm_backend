import type {
  ExpoPushMessage,
  ExpoPushReceipt,
  ExpoPushReceiptId,
  ExpoPushTicket,
} from "expo-server-sdk" with { "resolution-mode": "import" };
import type Expo from "expo-server-sdk" with { "resolution-mode": "import" };
import { expoPushConfig } from "../../config/expoPush";
import logger from "../../config/logger";
import { deviceTokensRepository } from "./deviceTokens.repository";

export interface PushNotificationPayload {
  tokens: string[];
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: ExpoPushMessage["sound"];
  badge?: number;
  channelId?: string;
  priority?: ExpoPushMessage["priority"];
}

export interface PushNotificationSendResult {
  tickets: ExpoPushTicket[];
  invalidTokens: string[];
  removedTokens: string[];
  failedTickets: ExpoPushTicket[];
  sentCount: number;
  failedCount: number;
}

let expoInstance: Expo | undefined;

async function getExpoInstance(): Promise<Expo> {
  if (!expoInstance) {
    const { default: ExpoClass } = await import("expo-server-sdk");
    expoInstance = new ExpoClass({
      accessToken: expoPushConfig.accessToken,
      maxConcurrentRequests: expoPushConfig.maxConcurrentRequests,
      retryMinTimeout: expoPushConfig.retryMinTimeout,
    });
  }
  return expoInstance;
}

export const pushNotificationService = {
  async isValidExpoPushToken(token: string): Promise<boolean> {
    const { default: Expo } = await import("expo-server-sdk");
    return Expo.isExpoPushToken(token);
  },

  async sendToTokens(payload: PushNotificationPayload): Promise<PushNotificationSendResult> {
    const { default: Expo } = await import("expo-server-sdk");
    const expo = await getExpoInstance();
    const invalidTokens: string[] = [];
    const messages: ExpoPushMessage[] = [];
    const messageTokens: string[] = [];

    for (const token of payload.tokens) {
      if (!Expo.isExpoPushToken(token)) {
        invalidTokens.push(token);
        continue;
      }

      messages.push({
        to: token,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        sound: payload.sound ?? "default",
        badge: payload.badge,
        channelId: payload.channelId,
        priority: payload.priority ?? "default",
      });
      messageTokens.push(token);
    }

    const removedTokens = await removeInvalidTokens(invalidTokens);

    if (messages.length === 0) {
      return {
        tickets: [],
        invalidTokens,
        removedTokens,
        failedTickets: [],
        sentCount: 0,
        failedCount: 0,
      };
    }

    const tickets: ExpoPushTicket[] = [];
    const failedTickets: ExpoPushTicket[] = [];
    const deviceNotRegisteredTokens: string[] = [];
    const chunks = expo.chunkPushNotifications(messages);
    let ticketOffset = 0;

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        for (let i = 0; i < ticketChunk.length; i++) {
          const ticket = ticketChunk[i];
          if (ticket.status === "error") {
            failedTickets.push(ticket);
            if (ticket.details?.error === "DeviceNotRegistered") {
              const token = messageTokens[ticketOffset + i];
              if (token) deviceNotRegisteredTokens.push(token);
            }
          }
        }
        ticketOffset += chunk.length;
      } catch (err: any) {
        logger.error("Expo push notification chunk failed", {
          message: err?.message,
          stack: err?.stack,
        });
        throw err;
      }
    }

    removedTokens.push(...await removeInvalidTokens(deviceNotRegisteredTokens));

    return {
      tickets,
      invalidTokens,
      removedTokens: Array.from(new Set(removedTokens)),
      failedTickets,
      sentCount: tickets.filter((ticket) => ticket.status === "ok").length,
      failedCount: failedTickets.length,
    };
  },

  async getReceipts(receiptIds: ExpoPushReceiptId[]): Promise<Record<string, ExpoPushReceipt>> {
    const expo = await getExpoInstance();
    const receipts: Record<string, ExpoPushReceipt> = {};
    const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    for (const chunk of chunks) {
      const receiptChunk = await expo.getPushNotificationReceiptsAsync(chunk);
      Object.assign(receipts, receiptChunk);
    }

    return receipts;
  },
};

async function removeInvalidTokens(tokens: string[]): Promise<string[]> {
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));

  for (const token of uniqueTokens) {
    try {
      await deviceTokensRepository.removeToken(token);
    } catch (err: any) {
      logger.warn("Failed to remove invalid Expo push token", {
        token,
        message: err?.message,
      });
    }
  }

  return uniqueTokens;
}
