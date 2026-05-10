import { Router, Request, Response } from 'express';
import axios from 'axios';
import QAData from './qa.json';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────
interface QAItem {
  id: string;
  cat: string;
  triggers: string[];
  answer: string;
}

const QA: QAItem[] = QAData as QAItem[];

console.log(`[BOT] Loaded ${QA.length} Q&As from qa.json`);
console.log(`[BOT] GROQ_API_KEY loaded: ${!!process.env.GROQ_API_KEY}`);
console.log(`[BOT] GROQ_API_KEY starts with: ${process.env.GROQ_API_KEY?.substring(0, 8)}...`);

// ── Keyword matcher ───────────────────────────────────────────────────────────
function matchPredefined(text: string): QAItem | null {
  const t = text.toLowerCase().trim();
  let best: QAItem | null = null;
  let bestScore = 0;

  QA.forEach((qa) => {
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

console.log(`[BOT] Match result for "${text}": ${best ? (best as QAItem).id : 'none'}`);  return bestScore > 0 ? best : null;
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
router.post('/ask', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question } = req.body as { question: string };
    console.log(`[BOT] /ask called with question: "${question}"`);

    if (!question || question.trim() === '') {
      console.log('[BOT] Empty question received');
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Step 1 — predefined check (Groq NOT called, free)
    const match = matchPredefined(question);
    if (match) {
      console.log(`[BOT] Returning predefined answer for ${match.id}`);
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
    res.json({
      answer: groqAnswer,
      source: 'groq',
      category: null,
      id: null,
    });

  } catch (error: any) {
    console.error('[BOT ERROR] Full error:', error?.message);
    console.error('[BOT ERROR] Stack:', error?.stack);
    res.status(500).json({
      answer: 'Something went wrong. Please try again.',
      source: 'error',
    });
  }
});

// ── GET /api/v1/bot/qa ────────────────────────────────────────────────────────
router.get('/qa', (_req: Request, res: Response): void => {
  console.log(`[BOT] /qa called — returning ${QA.length} items`);
  res.json(QA);
});

// ── GET /api/v1/bot/health ────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response): void => {
  console.log('[BOT] /health called');
  res.json({
    status: 'ok',
    totalQA: QA.length,
    groqEnabled: !!process.env.GROQ_API_KEY,
    groqKeyPrefix: process.env.GROQ_API_KEY?.substring(0, 8) || 'NOT SET',
  });
});

export default router;