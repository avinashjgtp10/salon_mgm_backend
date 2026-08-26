export type BotQuestionSource = "predefined" | "groq" | "error";

export interface BotQuestion {
  id: string;
  salon_id: string | null;
  salon_name?: string | null;
  user_id: string | null;
  question: string;
  answer: string | null;
  source: BotQuestionSource;
  matched_id: string | null;
  matched_category: string | null;
  created_at: string;
}

export interface LogBotQuestionInput {
  salon_id: string | null;
  user_id: string | null;
  question: string;
  answer: string | null;
  source: BotQuestionSource;
  matched_id: string | null;
  matched_category: string | null;
}

export interface BotQuestionListFilters {
  answered?: "answered" | "unanswered";
  source?: BotQuestionSource;
  search?: string;
  page?: number;
  limit?: number;
}

export interface FrequentQuestion {
  matched_id: string | null;
  matched_category: string | null;
  sample_question: string;
  ask_count: number;
  last_asked_at: string;
}

export interface PredefinedQuestion {
  id: string;
  category: string;
  triggers: string[];
  answer: string;
  created_at: string;
  updated_at: string;
}

export interface SaveAnswerInput {
  botQuestionId: string;
  category: string;
  triggers: string[];
  answer: string;
}
