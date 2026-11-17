-- Meetings: Minutes of Meeting (MOM) text, which can be sent to the client on WhatsApp.
ALTER TABLE client_meetings ADD COLUMN IF NOT EXISTS mom TEXT;
