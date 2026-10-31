import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { assertModuleUnlocked } from '../../middleware/moduleLock.middleware';
import { botQuestionsRepository } from './bot-questions.repository';

// The old chatbot (predefined-question matching + Groq fallback) has been removed.
// This router is kept mounted at /api/v1/bot so the new assistant can be wired in later.
const router = Router();

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

// The Chatbot (the support chat bubble) is its own plan module, separate from LUNOX. A question typed into it is sent to the
// Super Admin's Chatbot Inbox (Chatbot Question History); the reply comes back into the same chat bubble. It never calls
// the LUNOX AI, so it works with or without LUNOX.
router.post('/ask', authMiddleware, async (req: Request & { user?: { userId: string; salonId?: string | null } }, res: Response, next: NextFunction) => {
  try {
    const question = String(req.body?.question ?? '').trim().slice(0, 1000);
    if (!question) {
      res.status(400).json({ success: false, error: { message: 'Question is required' } });
      return;
    }
    const salonId = req.user?.salonId ?? null;
    await assertModuleUnlocked(salonId, 'chatbot');
    const saved = await botQuestionsRepository.logQuestion({
      salon_id: salonId, user_id: req.user?.userId ?? null, question,
      answer: null, source: 'groq', matched_id: null, matched_category: null,
    });
    res.status(201).json({ success: true, data: { id: saved.id, message: 'Thanks! Your question has been sent to our support team. Their reply will appear here.' } });
  } catch (err) { next(err); }
});

export default router;
