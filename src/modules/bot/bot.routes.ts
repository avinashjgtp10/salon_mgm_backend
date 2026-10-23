import { Router, Request, Response } from 'express';

// The old chatbot (predefined-question matching + Groq fallback) has been removed.
// This router is kept mounted at /api/v1/bot so the new assistant can be wired in later.
const router = Router();

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

export default router;
