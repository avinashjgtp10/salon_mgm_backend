-- "Ask client source at checkout" can now run once per client. This column records when staff answered the prompt
-- for a client, so a client whose source happens to be the default "walk_in" is still not asked again.
-- NULL = never asked. Not backfilled: clients with a real (non walk_in) source are already treated as answered by the app.
-- Per project policy NOT auto-run; apply by hand (dev -> QA -> prod) BEFORE the backend deploy
-- (the client update writes this column once the checkout prompt is answered).

ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_asked_at TIMESTAMPTZ;
