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
  receiptReferences: ExpoPushReceiptReference[];
  invalidTokens: string[];
  removedTokens: string[];
  failedTickets: ExpoPushTicket[];
  sentCount: number;
  failedCount: number;
}

export interface ExpoPushReceiptReference {
  receiptId: ExpoPushReceiptId;
  token: string;
}

const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

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

    if (invalidTokens.length > 0) {
      logger.warn("Expo push token validation failed", {
        error: "InvalidPushToken",
        invalidTokenCount: invalidTokens.length,
      });
    }

    const removedTokens = await removeInvalidTokens(invalidTokens);

    if (messages.length === 0) {
      return {
        tickets: [],
        receiptReferences: [],
        invalidTokens,
        removedTokens,
        failedTickets: [],
        sentCount: 0,
        failedCount: 0,
      };
    }

    const tickets: ExpoPushTicket[] = [];
    const receiptReferences: ExpoPushReceiptReference[] = [];
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
          const token = messageTokens[ticketOffset + i];

          if (ticket.status === "ok" && token) {
            receiptReferences.push({ receiptId: ticket.id, token });
          }

          if (ticket.status === "error") {
            failedTickets.push(ticket);
            const logData = {
              error: ticket.details?.error,
              message: ticket.message,
            };

            if (ticket.details?.error === "InvalidCredentials") {
              logger.error("Expo push ticket InvalidCredentials", logData);
            } else {
              logger.warn("Expo push ticket failed", logData);
            }

            if (ticket.details?.error === "DeviceNotRegistered") {
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
      receiptReferences,
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

  scheduleReceiptCheck(
    references: ExpoPushReceiptReference[],
    delayMs = RECEIPT_CHECK_DELAY_MS
  ): void {
    if (references.length === 0) return;

    const timer = setTimeout(() => {
      void processReceiptReferences(references);
    }, delayMs);

    // Receipt processing must not keep an otherwise idle Node process alive.
    timer.unref();
  },
};

async function processReceiptReferences(references: ExpoPushReceiptReference[]): Promise<void> {
  try {
    const uniqueReferences = Array.from(
      new Map(references.map((reference) => [reference.receiptId, reference])).values()
    );
    const receipts = await pushNotificationService.getReceipts(
      uniqueReferences.map((reference) => reference.receiptId)
    );

    for (const reference of uniqueReferences) {
      const receipt = receipts[reference.receiptId];

      if (!receipt) {
        logger.warn("Expo push receipt not available", { receiptId: reference.receiptId });
        continue;
      }

      if (receipt.status === "ok") {
        continue;
      }

      // Keep this widened because Expo can add provider error codes before the
      // installed SDK's TypeScript union is updated (for example InvalidPushToken).
      const errorCode: string | undefined = receipt.details?.error;
      const logData = {
        receiptId: reference.receiptId,
        status: receipt.status,
        error: errorCode,
        message: receipt.message,
      };

      if (errorCode === "DeviceNotRegistered") {
        await removeInvalidTokens([reference.token]);
        logger.warn("Expo device token removed from receipt", logData);
      } else if (errorCode === "InvalidCredentials") {
        logger.error("Expo push receipt InvalidCredentials", logData);
      } else if (errorCode === "InvalidPushToken") {
        await removeInvalidTokens([reference.token]);
        logger.warn("Expo push receipt InvalidPushToken", logData);
      } else if (errorCode === "MessageTooBig") {
        logger.warn("Expo push receipt MessageTooBig", logData);
      } else if (errorCode === "MessageRateExceeded") {
        logger.warn("Expo push receipt MessageRateExceeded", logData);
      } else {
        logger.warn("Expo push receipt failed", logData);
      }
    }
  } catch (err: any) {
    logger.error("Expo push receipt check failed", {
      message: err?.message,
      stack: err?.stack,
      receiptCount: references.length,
    });
  }
}

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
