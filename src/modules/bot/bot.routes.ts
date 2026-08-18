import { Router, Request, Response } from 'express';
import axios from 'axios';
import pool from '../../config/database';
import { botQuestionsService } from './bot-questions.service';

const router = Router();

type AuthRequest = Request & { user?: { userId: string; salonId?: string | null } };

// ── Types ─────────────────────────────────────────────────────────────────────
interface QAItem {
  id: string;
  cat: string;
  triggers: string[];
  answer: string;
}

console.log(`[BOT] GROQ_API_KEY loaded: ${!!process.env.GROQ_API_KEY}`);
console.log(`[BOT] GROQ_API_KEY starts with: ${process.env.GROQ_API_KEY?.substring(0, 8)}...`);

// ── Keyword matcher ───────────────────────────────────────────────────────────
// Reads predefined_questions fresh on every call (not cached in memory) so
// answers Super Admin saves via the Question History "Answer" flow are
// matchable immediately, with no redeploy/restart needed.
async function matchPredefined(text: string): Promise<QAItem | null> {
  const { rows } = await pool.query(
    `SELECT id, category AS cat, triggers, answer FROM predefined_questions`
  );

  const t = text.toLowerCase().trim();
  let best: QAItem | null = null;
  let bestScore = 0;

  (rows as QAItem[]).forEach((qa) => {
    let score = 0;
    qa.triggers.forEach((trigger) => {
      if (t.includes(trigger.toLowerCase())) {
        score += trigger.split(' ').length * 2;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = qa;
    }
  });

  console.log(`[BOT] Match result for "${text}": ${best ? (best as QAItem).id : 'none'}`);
  return bestScore > 0 ? best : null;
}

// ── Groq fallback ─────────────────────────────────────────────────────────────
async function callGroq(question: string): Promise<string> {
  console.log(`[BOT] Calling Groq for: "${question}"`);
  console.log(`[BOT] Using key: ${process.env.GROQ_API_KEY?.substring(0, 8)}...`);

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are SalonOx Assistant — a support bot for a salon management app like Fresha.
Answer about: bookings, payments, clients, staff, WhatsApp marketing, catalog, reports, account settings.
Keep answers short and practical — under 3 sentences.
If unsure, say: "Please contact SalonOx support for help with this."`,
          },
          { role: 'user', content: question },
        ],
        max_tokens: 200,
        temperature: 0.5,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
      }
    );

    const answer = response.data.choices?.[0]?.message?.content;
    console.log(`[BOT] Groq response received: "${answer?.substring(0, 50)}..."`);
    return answer || "I couldn't find an answer. Please contact support.";

  } catch (groqError: any) {
    console.error('[BOT] Groq API error status:', groqError?.response?.status);
    console.error('[BOT] Groq API error data:', JSON.stringify(groqError?.response?.data));
    console.error('[BOT] Groq API error message:', groqError?.message);
    return "I couldn't reach the AI right now. Please try again shortly.";
  }
}

// ── POST /api/v1/bot/ask ──────────────────────────────────────────────────────
router.post('/ask', async (req: AuthRequest, res: Response): Promise<void> => {
  const salon_id = req.user?.salonId ?? null;
  const user_id = req.user?.userId ?? null;

  try {
    const { question } = req.body as { question: string };
    console.log(`[BOT] /ask called with question: "${question}"`);

    if (!question || question.trim() === '') {
      console.log('[BOT] Empty question received');
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Step 1 — predefined check (Groq NOT called, free)
    const match = await matchPredefined(question);
    if (match) {
      console.log(`[BOT] Returning predefined answer for ${match.id}`);
      botQuestionsService.logQuestion({
        salon_id, user_id, question,
        answer: match.answer,
        source: 'predefined',
        matched_id: match.id,
        matched_category: match.cat,
      });
      res.json({
        answer: match.answer,
        source: 'predefined',
        category: match.cat,
        id: match.id,
      });
      return;
    }

    // Step 2 — Groq fallback
    console.log('[BOT] No predefined match, falling back to Groq...');
    const groqAnswer = await callGroq(question);
    botQuestionsService.logQuestion({
      salon_id, user_id, question,
      answer: groqAnswer,
      source: 'groq',
      matched_id: null,
      matched_category: null,
    });
    res.json({
      answer: groqAnswer,
      source: 'groq',
      category: null,
      id: null,
    });

  } catch (error: any) {
    console.error('[BOT ERROR] Full error:', error?.message);
    console.error('[BOT ERROR] Stack:', error?.stack);
    botQuestionsService.logQuestion({
      salon_id, user_id,
      question: (req.body as { question?: string })?.question ?? '',
      answer: null,
      source: 'error',
      matched_id: null,
      matched_category: null,
    });
    res.status(500).json({
      answer: 'Something went wrong. Please try again.',
      source: 'error',
    });
  }
});

// ── GET /api/v1/bot/qa ────────────────────────────────────────────────────────
router.get('/qa', async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool.query(`SELECT id, category AS cat, triggers, answer FROM predefined_questions`);
  console.log(`[BOT] /qa called — returning ${rows.length} items`);
  res.json(rows);
});

// ── GET /api/v1/bot/health ────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  console.log('[BOT] /health called');
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM predefined_questions`);
  res.json({
    status: 'ok',
    totalQA: rows[0]?.count ?? 0,
    groqEnabled: !!process.env.GROQ_API_KEY,
    groqKeyPrefix: process.env.GROQ_API_KEY?.substring(0, 8) || 'NOT SET',
  });
});

export default router;