-- Multi-language support: the language a salon's screens, public booking page, receipts and messages are shown in.
--
-- 'en' = English (every existing salon keeps exactly what it has today). Supported codes live in
-- src/config/language.ts (en, hi, ar) and are validated by the API, so no CHECK constraint is needed here —
-- adding a language is a code change, not a migration.
--
-- Until this runs the app behaves as English everywhere: the API reads the column tolerantly (a missing column
-- is treated as 'en'), and saving a language from Settings returns an error.
--
-- Run BEFORE deploying the backend change that lets Settings save a language.
-- Safe to re-run.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'en';
