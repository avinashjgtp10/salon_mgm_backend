import pool from "../../config/database";
import { BotQuestion, LogBotQuestionInput, BotQuestionListFilters, FrequentQuestion, SaveAnswerInput, PredefinedQuestion } from "./bot-questions.types";

// A Groq-sourced row counts as "unanswered" if it never actually got a model
// reply — i.e. it fell through to callGroq's own error strings. Predefined
// matches are always answered; 'error' rows (unhandled /ask exceptions) are
// always unanswered. Matching these exact strings from bot.routes.ts keeps
// this a pure read-side classification — no schema flag needed.
const GROQ_FAILURE_STRINGS = [
  "I couldn't reach the AI right now. Please try again shortly.",
  "I couldn't find an answer. Please contact support.",
];

const UNANSWERED_SQL = `(
  source = 'error'
  OR (source = 'groq' AND (answer IS NULL OR answer = ANY($ANSWERED_PARAM::text[])))
)`;

export const botQuestionsRepository = {
  async logQuestion(input: LogBotQuestionInput): Promise<BotQuestion> {
    const { rows } = await pool.query(
      `INSERT INTO bot_questions
         (salon_id, user_id, question, answer, source, matched_id, matched_category, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       RETURNING *`,
      [
        input.salon_id,
        input.user_id,
        input.question,
        input.answer,
        input.source,
        input.matched_id,
        input.matched_category,
      ]
    );
    return rows[0];
  },

  async list(filters: BotQuestionListFilters): Promise<{ rows: BotQuestion[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.source) {
      conditions.push(`source = $${idx++}`);
      values.push(filters.source);
    }

    if (filters.answered === "unanswered") {
      values.push(GROQ_FAILURE_STRINGS);
      conditions.push(UNANSWERED_SQL.replace("$ANSWERED_PARAM", `$${idx++}`));
    } else if (filters.answered === "answered") {
      values.push(GROQ_FAILURE_STRINGS);
      conditions.push(`NOT ${UNANSWERED_SQL.replace("$ANSWERED_PARAM", `$${idx++}`)}`);
    }

    if (filters.search) {
      conditions.push(`question ILIKE $${idx++}`);
      values.push(`%${filters.search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT * FROM bot_questions ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM bot_questions ${where}`,
      values
    );

    return { rows, total: countRows[0]?.total ?? 0 };
  },

  // Most-asked predefined questions, grouped by matched_id so trigger-phrase
  // variants of the same qa.json entry count as one question. Unmatched
  // (Groq/error) rows have no matched_id and are excluded — there's no
  // stable grouping key for free-text questions.
  async mostFrequent(limit = 20): Promise<FrequentQuestion[]> {
    const { rows } = await pool.query(
      `SELECT
         matched_id,
         matched_category,
         (ARRAY_AGG(question ORDER BY created_at DESC))[1] AS sample_question,
         COUNT(*)::int AS ask_count,
         MAX(created_at) AS last_asked_at
       FROM bot_questions
       WHERE matched_id IS NOT NULL
       GROUP BY matched_id, matched_category
       ORDER BY ask_count DESC, last_asked_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async stats(): Promise<{ total: number; answered: number; unanswered: number; predefined: number; groq: number }> {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE source = 'predefined')::int AS predefined,
         COUNT(*) FILTER (WHERE source = 'groq')::int AS groq,
         COUNT(*) FILTER (WHERE NOT ${UNANSWERED_SQL.replace("$ANSWERED_PARAM", "$1")})::int AS answered,
         COUNT(*) FILTER (WHERE ${UNANSWERED_SQL.replace("$ANSWERED_PARAM", "$1")})::int AS unanswered
       FROM bot_questions`,
      [GROQ_FAILURE_STRINGS]
    );
    return rows[0];
  },

  // 30-day retention purge — called by bot-questions-cleanup.scheduler.ts.
  async deleteOlderThan(days: number): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM bot_questions WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [days]
    );
    return rowCount ?? 0;
  },

  async findById(id: string): Promise<BotQuestion | null> {
    const { rows } = await pool.query(`SELECT * FROM bot_questions WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  // Team member answering an unanswered question: adds/updates a
  // predefined_questions row (the live matching KB) and rewrites the
  // originating bot_questions log row so it now reads as answered/predefined.
  // Both writes happen in one transaction — a KB entry with no updated log
  // row (or vice versa) would leave the history page and the bot's matching
  // out of sync.
  async saveAnswer(input: SaveAnswerInput): Promise<{ predefined: PredefinedQuestion; botQuestion: BotQuestion }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const botQuestion = (await client.query(`SELECT * FROM bot_questions WHERE id = $1 FOR UPDATE`, [input.botQuestionId])).rows[0];
      if (!botQuestion) throw new Error("Question not found");

      const kbId = botQuestion.matched_id || `Q-${input.botQuestionId.slice(0, 8)}`;

      const { rows: pqRows } = await client.query(
        `INSERT INTO predefined_questions (id, category, triggers, answer, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (id) DO UPDATE SET category = $2, triggers = $3, answer = $4, updated_at = NOW()
         RETURNING *`,
        [kbId, input.category, input.triggers, input.answer]
      );

      const { rows: bqRows } = await client.query(
        `UPDATE bot_questions
         SET answer = $1, source = 'predefined', matched_id = $2, matched_category = $3
         WHERE id = $4
         RETURNING *`,
        [input.answer, kbId, input.category, input.botQuestionId]
      );

      await client.query("COMMIT");
      return { predefined: pqRows[0], botQuestion: bqRows[0] };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};
