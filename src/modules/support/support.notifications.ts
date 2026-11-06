import pool from "../../config/database";
import logger from "../../config/logger";
import { notificationsRepository } from "../notifications/notifications.repository";
import { ensurePlatformSalon, getPlatformSalonId } from "../client-announcements/platform-salon";

// Super Admin support notifications (tickets and callback requests). They are rows in the existing `notifications` table, kept
// under the platform salon (the salon SalonOx itself uses, also used by Client Announcements), with their own two types so they
// never mix with anything a real salon sees. "Read" is shared by the whole support team: one admin marking it read clears it for all.
//
// Every event gets a stable title (it carries the ticket / callback number and the event), and notificationsRepository.createOnce
// skips a notification that already exists for the same title, so retries, double clicks and the deadline sweeper can never
// raise the same event twice.

export const TICKET_TYPE = "support_ticket";
export const CALLBACK_TYPE = "support_callback";
const TYPES = [TICKET_TYPE, CALLBACK_TYPE];

export const isCallbackRow = (t: { category?: string | null }) => t.category === "Callback";
const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();
export const ticketNo = (id: string) => `TKT-${shortId(id)}`;
export const callbackNo = (id: string) => `CB-${shortId(id)}`;

export type SupportEvent =
  | { kind: "new" }
  | { kind: "assigned"; assignee: string }
  | { kind: "status"; status: string }
  | { kind: "reply" }
  | { kind: "due_soon" }
  | { kind: "overdue" };

const TICKET_STATUS_WORD: Record<string, string> = { open: "reopened", in_progress: "in progress", resolved: "resolved", closed: "closed" };
const CALLBACK_STATUS_WORD: Record<string, string> = { open: "reopened", in_progress: "in progress", resolved: "completed", closed: "missed" };

export interface SupportRow { id: string; category?: string | null; subject?: string | null; salon_name?: string | null; callback_phone?: string | null }

function describe(row: SupportRow, event: SupportEvent): { title: string; body: string } | null {
  const callback = isCallbackRow(row);
  const no = callback ? callbackNo(row.id) : ticketNo(row.id);
  const who = row.salon_name || "A salon";
  const noun = callback ? "Callback" : "Ticket";
  const detail = callback ? `${who}${row.callback_phone ? ` · ${row.callback_phone}` : ""}` : `${who}: ${row.subject ?? ""}`;
  switch (event.kind) {
    case "new":      return { title: callback ? `New callback request ${no}` : `New ticket ${no}`, body: detail };
    case "assigned": return { title: `${noun} ${no} assigned to ${event.assignee}`, body: detail };
    case "status": {
      const word = (callback ? CALLBACK_STATUS_WORD : TICKET_STATUS_WORD)[event.status];
      return word ? { title: `${noun} ${no} ${word === "reopened" || word === "in progress" ? "is" : "marked"} ${word}`, body: detail } : null;
    }
    case "reply":    return callback ? null : { title: `Support replied on ${no}`, body: detail };
    case "due_soon": return callback ? { title: `Callback ${no} is due soon`, body: `${detail}. The requested callback time is within 10 minutes.` } : null;
    case "overdue":  return callback ? { title: `Callback ${no} is overdue`, body: `${detail}. The requested callback time has passed.` } : null;
  }
}

/** Raises one support notification. Best effort: it never throws, so a notification problem can't fail the ticket action itself. */
export async function notifySupport(row: SupportRow, event: SupportEvent): Promise<void> {
  try {
    const content = describe(row, event);
    if (!content) return;
    const salonId = await getPlatformSalonId();
    if (!salonId) { logger.warn("Support notification skipped: the platform salon is not set up yet"); return; }
    await notificationsRepository.createOnce({
      salon_id: salonId,
      type: isCallbackRow(row) ? CALLBACK_TYPE : TICKET_TYPE,
      title: content.title,
      body: content.body,
      reference_id: row.id,
    });
  } catch (err: any) {
    logger.warn("Support notification failed", { ticketId: row.id, event: event.kind, error: err?.message });
  }
}

// ── What the Super Admin bell reads ───────────────────────────────────────────

export const supportNotificationsRepo = {
  // The first Super Admin to open the bell creates the platform salon if nobody has yet, so later events have somewhere to go.
  async list(adminUserId: string, limit = 30) {
    const salonId = await ensurePlatformSalon(adminUserId);
    const [{ rows }, { rows: count }] = await Promise.all([
      pool.query(
        `SELECT id, type, title, body, reference_id, is_read, created_at FROM notifications
         WHERE salon_id = $1 AND type = ANY($2::text[]) ORDER BY created_at DESC LIMIT $3`,
        [salonId, TYPES, limit]
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE salon_id = $1 AND type = ANY($2::text[]) AND is_read = false`, [salonId, TYPES]),
    ]);
    return { items: rows, unread: count[0]?.n ?? 0 };
  },

  async markRead(adminUserId: string, id: string): Promise<boolean> {
    const salonId = await ensurePlatformSalon(adminUserId);
    const { rowCount } = await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND salon_id = $2 AND type = ANY($3::text[])`, [id, salonId, TYPES]);
    return (rowCount ?? 0) > 0;
  },

  async markAllRead(adminUserId: string): Promise<void> {
    const salonId = await ensurePlatformSalon(adminUserId);
    await pool.query(`UPDATE notifications SET is_read = true WHERE salon_id = $1 AND type = ANY($2::text[]) AND is_read = false`, [salonId, TYPES]);
  },
};
