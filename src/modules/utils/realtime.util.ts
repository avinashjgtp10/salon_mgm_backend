import { getIO } from "../../config/socket";

export type RealtimeAction = "created" | "updated" | "deleted";

export function emitSalonEvent(event: string, salonId: string, entityId: string, action: RealtimeAction, data: unknown): void {
  try {
    getIO().to(`salon:${salonId}`).emit(event, { salonId, entityId, timestamp: new Date().toISOString(), action, data });
  } catch {
    // Socket.IO is optional during scripts/tests; database persistence remains authoritative.
  }
}
