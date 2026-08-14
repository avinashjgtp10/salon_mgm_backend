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
import {
  isCredentialOrProjectMismatchError,
  normalizeExpoErrorCode,
  shouldRemoveTokenForExpoError,
} from "./expoPushErrors";
import { pushReceiptsRepository, PushReceiptRecord } from "./pushReceipts.repository";

export interface PushNotificationPayload {
  tokens: string[];
  notificationId?: string;
  salonId?: string;
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
const RECEIPT_PROCESS_INTERVAL_MS = 5 * 60 * 1000;

let expoInstance: Expo | undefined;
let receiptSchedulerInterval: NodeJS.Timeout | null = null;

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

    const removedTokens = await removeInvalidTokens(invalidTokens, "InvalidPushToken");

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
    const chunks = messageTokens.map((_, index) => [messages[index]]);
    let ticketOffset = 0;

    for (const chunk of chunks) {
      try {
        logger.info("Sending Expo push notification chunk", {
          notificationId: payload.notificationId,
          salonId: payload.salonId,
          tokenCount: chunk.length,
        });
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        logger.info("Expo push notification tickets received", {
          notificationId: payload.notificationId,
          salonId: payload.salonId,
          okCount: ticketChunk.filter((ticket) => ticket.status === "ok").length,
          errorCount: ticketChunk.filter((ticket) => ticket.status === "error").length,
        });
        tickets.push(...ticketChunk);
        for (let i = 0; i < ticketChunk.length; i++) {
          const ticket = ticketChunk[i];
          const token = messageTokens[ticketOffset + i];

          if (ticket.status === "ok" && token) {
            receiptReferences.push({ receiptId: ticket.id, token });
          }

          if (ticket.status === "error") {
            failedTickets.push(ticket);
            const errorCode = String(ticket.details?.error ?? "UnknownExpoTicketError");
            const logData = {
              error: errorCode,
              message: ticket.message,
            };

            await markTokenFailure(token, errorCode, ticket.message);

            if (isCredentialOrProjectMismatchError(errorCode)) {
              logger.error("Expo push ticket credential/project mismatch", logData);
            } else {
              logger.warn("Expo push ticket failed", logData);
            }

            if (shouldRemoveTokenForExpoError(errorCode)) {
              if (token) deviceNotRegisteredTokens.push(token);
            }
          }
        }
        ticketOffset += chunk.length;
      } catch (err: any) {
        const token = messageTokens[ticketOffset];
        const errorCode = normalizeExpoErrorCode(err);
        await markTokenFailure(token, errorCode, err?.message);
        if (shouldRemoveTokenForExpoError(errorCode) && token) {
          deviceNotRegisteredTokens.push(token);
        }

        logger.error("Expo push notification chunk failed", {
          message: err?.message,
          stack: err?.stack,
          errorCode,
          tokenCount: chunk.length,
        });
        failedTickets.push({
          status: "error",
          message: err?.message ?? "Expo push request failed",
          details: { error: errorCode },
        } as ExpoPushTicket);
        ticketOffset += chunk.length;
      }
    }

    removedTokens.push(...await removeInvalidTokens(deviceNotRegisteredTokens, "ExpoProviderInvalidToken"));
    await deviceTokensRepository.markTokensSent(receiptReferences.map((reference) => reference.token));
    await pushReceiptsRepository.createPending(
      receiptReferences.map((reference) => ({
        receipt_id: reference.receiptId,
        notification_id: payload.notificationId ?? null,
        salon_id: payload.salonId ?? null,
        expo_push_token: reference.token,
        next_attempt_at: new Date(Date.now() + RECEIPT_CHECK_DELAY_MS),
      }))
    );

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

    logger.info("Scheduling Expo receipt check", {
      receiptCount: references.length,
      delayMs,
    });

    const timer = setTimeout(() => {
      void processReceiptReferences(references);
    }, delayMs);

    // Receipt processing must not keep an otherwise idle Node process alive.
    timer.unref();
  },

  async processDueReceipts(limit = 100): Promise<void> {
    const records = await pushReceiptsRepository.findDuePending(limit);
    if (records.length === 0) return;

    logger.info("Processing due Expo push receipts", { receiptCount: records.length });
    await processReceiptRecords(records);
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
        await pushReceiptsRepository.markUnavailable(reference.receiptId);
        continue;
      }

      if (receipt.status === "ok") {
        await pushReceiptsRepository.markOk(reference.receiptId);
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

      await pushReceiptsRepository.markError(reference.receiptId, errorCode, receipt.message);
      await markTokenFailure(reference.token, errorCode ?? "UnknownExpoReceiptError", receipt.message);

      if (errorCode && shouldRemoveTokenForExpoError(errorCode)) {
        await removeInvalidTokens([reference.token], `${errorCode} (receipt)`);
        logger.warn("Expo device token removed from receipt", logData);
      } else if (errorCode && isCredentialOrProjectMismatchError(errorCode)) {
        logger.error("Expo push receipt credential/project mismatch", logData);
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

async function processReceiptRecords(records: PushReceiptRecord[]): Promise<void> {
  await processReceiptReferences(
    records.map((record) => ({
      receiptId: record.receipt_id,
      token: record.expo_push_token,
    }))
  );
}

async function markTokenFailure(
  token: string | undefined,
  errorCode: string,
  errorMessage?: string | null
): Promise<void> {
  if (!token) return;

  try {
    await deviceTokensRepository.markTokenFailure(token, errorCode, errorMessage);
  } catch (err: any) {
    logger.warn("Failed to mark Expo token failure", {
      errorCode,
      message: err?.message,
    });
  }
}

async function removeInvalidTokens(tokens: string[], reason = "unknown"): Promise<string[]> {
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));

  for (const token of uniqueTokens) {
    try {
      logger.info("Removing invalid Expo push token", {
        tokenPrefix: token.slice(0, 20),
        reason,
      });
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

export function startPushReceiptScheduler(): void {
  if (receiptSchedulerInterval) return;

  logger.info("Expo push receipt scheduler started");
  pushNotificationService.processDueReceipts().catch((err: any) =>
    logger.error("Expo push receipt scheduler initial run failed", { message: err?.message })
  );

  receiptSchedulerInterval = setInterval(() => {
    pushNotificationService.processDueReceipts().catch((err: any) =>
      logger.error("Expo push receipt scheduler run failed", { message: err?.message })
    );
  }, RECEIPT_PROCESS_INTERVAL_MS);
}

export function stopPushReceiptScheduler(): void {
  if (!receiptSchedulerInterval) return;

  clearInterval(receiptSchedulerInterval);
  receiptSchedulerInterval = null;
  logger.info("Expo push receipt scheduler stopped");
}
