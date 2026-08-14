import pool from "../../config/database";

export type PushReceiptStatus = "pending" | "ok" | "error";

export interface PushReceiptRecord {
  receipt_id: string;
  notification_id: string | null;
  salon_id: string | null;
  expo_push_token: string;
  status: PushReceiptStatus;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  next_attempt_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePushReceiptParams {
  receipt_id: string;
  notification_id?: string | null;
  salon_id?: string | null;
  expo_push_token: string;
  next_attempt_at?: Date;
}

export const pushReceiptsRepository = {
  async createPending(records: CreatePushReceiptParams[]): Promise<void> {
    if (records.length === 0) return;

    const values: unknown[] = [];
    const placeholders = records.map((record, index) => {
      const base = index * 5;
      values.push(
        record.receipt_id,
        record.notification_id ?? null,
        record.salon_id ?? null,
        record.expo_push_token,
        record.next_attempt_at ?? new Date(Date.now() + 15 * 60 * 1000)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await pool.query(
      `INSERT INTO push_notification_receipts
         (receipt_id, notification_id, salon_id, expo_push_token, next_attempt_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (receipt_id) DO UPDATE SET
         notification_id = EXCLUDED.notification_id,
         salon_id = EXCLUDED.salon_id,
         expo_push_token = EXCLUDED.expo_push_token,
         status = 'pending',
         error_code = NULL,
         error_message = NULL,
         next_attempt_at = EXCLUDED.next_attempt_at,
         processed_at = NULL,
         updated_at = NOW()`,
      values
    );
  },

  async findDuePending(limit = 100): Promise<PushReceiptRecord[]> {
    const { rows } = await pool.query<PushReceiptRecord>(
      `SELECT *
       FROM push_notification_receipts
       WHERE status = 'pending'
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async markOk(receiptId: string): Promise<void> {
    await pool.query(
      `UPDATE push_notification_receipts
       SET status = 'ok',
           error_code = NULL,
           error_message = NULL,
           processed_at = NOW(),
           updated_at = NOW()
       WHERE receipt_id = $1`,
      [receiptId]
    );
  },

  async markError(receiptId: string, errorCode?: string | null, errorMessage?: string | null): Promise<void> {
    await pool.query(
      `UPDATE push_notification_receipts
       SET status = 'error',
           error_code = $2,
           error_message = $3,
           processed_at = NOW(),
           updated_at = NOW()
       WHERE receipt_id = $1`,
      [receiptId, errorCode ?? null, errorMessage ?? null]
    );
  },

  async markUnavailable(receiptId: string): Promise<void> {
    await pool.query(
      `UPDATE push_notification_receipts
       SET attempts = attempts + 1,
           next_attempt_at = NOW() + INTERVAL '15 minutes',
           updated_at = NOW()
       WHERE receipt_id = $1`,
      [receiptId]
    );
  },
};
