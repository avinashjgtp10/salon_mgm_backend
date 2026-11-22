-- Meetings: a Product Training meeting records which training module(s) it covers (one or more).
ALTER TABLE client_meetings ADD COLUMN IF NOT EXISTS training_module_ids UUID[] NOT NULL DEFAULT '{}';
