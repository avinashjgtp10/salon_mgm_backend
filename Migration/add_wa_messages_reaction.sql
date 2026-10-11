-- Marketing > Inbox: emoji reactions. For an INBOUND message this holds OUR
-- reaction to it; for an OUTBOUND message it holds the CUSTOMER's reaction.
-- Run on dev, QA and prod BEFORE deploying the backend that stores them; without
-- it reactions are still sent to / received from WhatsApp, they just are not
-- remembered after a refresh. Safe to re-run.

ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS reaction VARCHAR(16);
