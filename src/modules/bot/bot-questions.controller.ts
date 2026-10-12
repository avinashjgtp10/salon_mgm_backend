import { Request, Response, NextFunction } from "express";
import { getIO, salonRoom } from "../../config/socket";
import { sendSuccess } from "../utils/response.util";
import { botQuestionsService } from "./bot-questions.service";
import { BotQuestionSource } from "./bot-questions.types";

export const botQuestionsController = {
  // GET /api/v1/bot-questions — super admin, paginated question history
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { answered, source, search, page, limit } = req.query as Record<string, string>;
      const { rows, total } = await botQuestionsService.list({
        answered: answered === "answered" || answered === "unanswered" ? answered : undefined,
        source: source as BotQuestionSource | undefined,
        search,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      const limitNum = Math.min(Math.max(limit ? parseInt(limit, 10) : 25, 1), 100);
      const pageNum = Math.max(page ? parseInt(page, 10) : 1, 1);
      sendSuccess(res, 200, {
        items: rows,
        total,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.max(Math.ceil(total / limitNum), 1),
      }, "Question history fetched");
    } catch (err) { next(err); }
  },

  // GET /api/v1/bot-questions/frequent — super admin, most-asked predefined questions
  async mostFrequent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit } = req.query as Record<string, string>;
      const data = await botQuestionsService.mostFrequent(limit ? parseInt(limit, 10) : undefined);
      sendSuccess(res, 200, data, "Frequently asked questions fetched");
    } catch (err) { next(err); }
  },

  // GET /api/v1/bot-questions/stats — super admin, totals for the header cards
  async stats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await botQuestionsService.stats();
      sendSuccess(res, 200, data, "Question history stats fetched");
    } catch (err) { next(err); }
  },

  // POST /api/v1/bot-questions/:id/reply — super admin replies to ONE salon user's question.
  // Saved on that question only; the shared knowledge base is not touched.
  async reply(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reply = String((req.body as { answer?: string })?.answer ?? "").trim();
      if (!reply) { res.status(400).json({ error: "Reply is required" }); return; }
      if (reply.length > 2000) { res.status(400).json({ error: "Reply is too long (max 2000 characters)" }); return; }
      const data = await botQuestionsService.replyDirect(String(req.params.id), reply);
      if (data === null) { res.status(404).json({ error: "Question not found" }); return; }
      if (data === "no_recipient") {
        res.status(400).json({ error: "This question was asked without a login, so there is no salon user to reply to. Use 'All salons' instead." });
        return;
      }
      // Live push: a payload-free signal (no reply text) to the salon's room. The asker's
      // browser sees its own user id, fetches the reply once through the authenticated
      // API, and opens the chatbot. Failure to emit never fails the reply itself.
      try {
        const row = data as { salon_id?: string | null; user_id?: string | null };
        if (row.salon_id && row.user_id) getIO().to(salonRoom(row.salon_id)).emit("bot_reply", { user_id: row.user_id });
      } catch { /* socket not available — the asker still gets it on next load */ }
      sendSuccess(res, 200, data, "Reply sent to the salon");
    } catch (err) { next(err); }
  },

  // GET /api/v1/bot-questions/my-replies — the logged-in user's own replies only.
  async myReplies(req: Request & { user?: { userId: string; salonId?: string | null } }, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      const salonId = req.user?.salonId;
      if (!userId || !salonId) { sendSuccess(res, 200, [], "No replies"); return; }
      sendSuccess(res, 200, await botQuestionsService.listRepliesForUser(userId, salonId), "Replies fetched");
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/bot-questions/:id/read — the asker marks their reply as seen.
  async markReplyRead(req: Request & { user?: { userId: string; salonId?: string | null } }, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      const salonId = req.user?.salonId;
      if (!userId || !salonId) { res.status(404).json({ error: "Reply not found" }); return; }
      const ok = await botQuestionsService.markReplyRead(String(req.params.id), userId, salonId);
      if (!ok) { res.status(404).json({ error: "Reply not found" }); return; }
      sendSuccess(res, 200, { read: true }, "Marked as read");
    } catch (err) { next(err); }
  },

  // POST /api/v1/bot-questions/:id/answer — super admin, writes the answer
  // into the knowledge base (predefined_questions) and marks the logged
  // question as answered.
  async answer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const { category, triggers, answer } = req.body as { category?: string; triggers?: string[]; answer?: string };

      if (!answer?.trim()) {
        res.status(400).json({ error: "Answer is required" });
        return;
      }
      if (!category?.trim()) {
        res.status(400).json({ error: "Category is required" });
        return;
      }
      const cleanTriggers = (triggers ?? []).map((t) => t.trim()).filter(Boolean);
      if (cleanTriggers.length === 0) {
        res.status(400).json({ error: "At least one trigger phrase is required" });
        return;
      }

      const data = await botQuestionsService.saveAnswer({
        botQuestionId: id,
        category: category.trim(),
        triggers: cleanTriggers,
        answer: answer.trim(),
      });
      sendSuccess(res, 200, data, "Answer saved to knowledge base");
    } catch (err: any) {
      if (err?.message === "Question not found") {
        res.status(404).json({ error: "Question not found" });
        return;
      }
      next(err);
    }
  },
};
