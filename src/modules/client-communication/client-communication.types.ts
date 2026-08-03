// Unified WhatsApp communication feed for the Client History "Communication"
// tab — merges the two separate systems that actually send WhatsApp messages
// today (see client-communication.repository.ts for why they're separate
// tables). SMS/Email have no sending/logging infrastructure anywhere in this
// codebase yet, so this type only ever represents WhatsApp — the frontend is
// responsible for rendering the "Not available" placeholder for those two
// channels itself.
export type ClientCommunicationEntry = {
  channel: "whatsapp";
  source: "automation" | "campaign";
  // Automation: the event that triggered it (e.g. "appointment_reminder_24h").
  // Campaign: the campaign's own name.
  label: string;
  status: string; // SENT | DELIVERED | READ | FAILED | SKIPPED | BLOCKED | ...
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};
