import logger from '../../config/logger';
import { botQuestionsRepository } from "./bot-questions.repository";
import { LogBotQuestionInput, BotQuestionListFilters, SaveAnswerInput } from "./bot-questions.types";

const RETENTION_DAYS = 30;

export const botQuestionsService = {
  // Fire-and-forget from bot.routes.ts — logging failures must never break
  // the /ask response the salon user is waiting on.
  async logQuestion(input: LogBotQuestionInput): Promise<void> {
    try {
      await botQuestionsRepository.logQuestion(input);
    } catch (err: any) {
      logger.warn("[BOT-QUESTIONS] Failed to log question:", err?.message);
    }
  },

  async list(filters: BotQuestionListFilters) {
    return botQuestionsRepository.list(filters);
  },

  async mostFrequent(limit?: number) {
    return botQuestionsRepository.mostFrequent(limit);
  },

  async stats() {
    return botQuestionsRepository.stats();
  },

  async runRetentionCleanup(): Promise<number> {
    return botQuestionsRepository.deleteOlderThan(RETENTION_DAYS);
  },

  async replyDirect(id: string, reply: string) {
    return botQuestionsRepository.replyDirect(id, reply);
  },

  async listRepliesForUser(userId: string, salonId: string) {
    return botQuestionsRepository.listRepliesForUser(userId, salonId);
  },

  async markReplyRead(id: string, userId: string, salonId: string) {
    return botQuestionsRepository.markReplyRead(id, userId, salonId);
  },

  async saveAnswer(input: SaveAnswerInput) {
    return botQuestionsRepository.saveAnswer(input);
  },
};
