import pool from "../../config/database";
import { ClientCommunicationEntry } from "./client-communication.types";

// Two separate systems actually send WhatsApp messages today:
// 1. wa_automation_logs — 1:1 automated sends (reminders, receipts, birthday,
//    review requests), already has a direct client_id column.
// 2. wa_campaign_contacts — bulk marketing campaigns, has no client_id at
//    all, only the recipient's raw `phone`. Matched to this client by phone
//    SUFFIX (not exact string equality) since wa_campaign_contacts.phone may
//    or may not include the country code prefix the client record stores
//    separately — a suffix match on the client's own digits-only number is
//    correct either way and avoids over-matching a shorter number as a
//    substring of a longer one (LIKE '%'||phone would still be exact-suffix,
//    not substring, since phone is the full recipient number here).
export const clientCommunicationRepository = {
  async listForClient(
    clientId: string, salonId: string, clientPhoneDigits: string | null,
  ): Promise<ClientCommunicationEntry[]> {
    const automationPromise = pool.query(
      `SELECT event_type AS label, status, sent_at, delivered_at, read_at, created_at
       FROM wa_automation_logs
       WHERE client_id = $1 AND salon_id = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [clientId, salonId],
    );

    const campaignPromise = clientPhoneDigits
      ? pool.query(
          `SELECT c.name AS label, cc.status, cc.sent_at, cc.delivered_at, cc.read_at, cc.created_at
           FROM wa_campaign_contacts cc
           JOIN wa_campaigns c ON c.id = cc.campaign_id
           WHERE c.salon_id = $1 AND cc.phone LIKE '%' || $2
           ORDER BY cc.created_at DESC
           LIMIT 200`,
          [salonId, clientPhoneDigits],
        )
      : Promise.resolve({ rows: [] as any[] });

    const [automationRes, campaignRes] = await Promise.all([automationPromise, campaignPromise]);

    const entries: ClientCommunicationEntry[] = [
      ...automationRes.rows.map((r: any) => ({
        channel: "whatsapp" as const,
        source: "automation" as const,
        label: r.label,
        status: r.status,
        sent_at: r.sent_at,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
        created_at: r.created_at,
      })),
      ...campaignRes.rows.map((r: any) => ({
        channel: "whatsapp" as const,
        source: "campaign" as const,
        label: r.label,
        status: r.status,
        sent_at: r.sent_at,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
        created_at: r.created_at,
      })),
    ];

    entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return entries;
  },
};
