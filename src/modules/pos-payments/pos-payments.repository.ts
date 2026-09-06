import pool from '../../config/database';
import { PosPaymentRequest, PosPaymentStatus, NON_TERMINAL_STATUSES, CreatePosPaymentBody } from './pos-payments.types';

export const posPaymentsRepository = {

  /**
   * Same atomic-sequence + SAVEPOINT-retry pattern as sales.repository.ts's
   * invoice-number generator (next_invoice_seq) — copied exactly, just
   * against next_payment_seq and the pos_payment_requests unique constraint.
   */
  async create(data: CreatePosPaymentBody & { provider: string }): Promise<PosPaymentRequest> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let request: PosPaymentRequest | undefined;
      for (let attempt = 0; ; attempt++) {
        const { rows: seqRows } = await client.query(
          `UPDATE salons SET next_payment_seq = next_payment_seq + 1
           WHERE id = $1 RETURNING next_payment_seq - 1 AS seq`,
          [data.salon_id],
        );
        const seq = seqRows[0].seq;
        const reference = `PAY-${String(seq).padStart(5, '0')}`;

        await client.query('SAVEPOINT pos_payment_insert_attempt');
        try {
          const { rows } = await client.query(
            `INSERT INTO pos_payment_requests (
               salon_id, branch_id, appointment_id, client_id, terminal_id,
               payment_reference, provider, amount, currency, status,
               payload, created_by, expires_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'INR','PENDING',$9::jsonb,$10, NOW() + INTERVAL '20 minutes')
             RETURNING *`,
            [
              data.salon_id, data.branch_id ?? null, data.appointment_id, data.client_id ?? null,
              data.terminal_id ?? null, reference, data.provider, data.amount,
              JSON.stringify(data.payload), data.created_by,
            ],
          );
          await client.query('RELEASE SAVEPOINT pos_payment_insert_attempt');
          request = rows[0];
          break;
        } catch (insertErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT pos_payment_insert_attempt');
          const isCollision = insertErr?.code === '23505' && insertErr?.constraint === 'pos_payment_requests_salon_reference_key';
          if (!isCollision || attempt >= 5) throw insertErr;
        }
      }
      await client.query('COMMIT');
      return request!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findById(id: string, salonId: string): Promise<PosPaymentRequest | null> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return rows[0] ?? null;
  },

  async findByReference(reference: string, salonId: string): Promise<PosPaymentRequest | null> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests WHERE payment_reference = $1 AND salon_id = $2`,
      [reference, salonId],
    );
    return rows[0] ?? null;
  },

  /** Duplicate-payment guard — payments.service.ts itself has no such guard. */
  async findNonTerminalForAppointment(appointmentId: string, salonId: string): Promise<PosPaymentRequest | null> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests
       WHERE appointment_id = $1 AND salon_id = $2 AND status = ANY($3::text[])
       ORDER BY created_at DESC LIMIT 1`,
      [appointmentId, salonId, NON_TERMINAL_STATUSES],
    );
    return rows[0] ?? null;
  },

  /**
   * Single atomic conditional UPDATE — never SELECT-then-UPDATE. A duplicate
   * webhook/poll landing on an already-terminal request returns null (no-op),
   * not an error.
   */
  async transitionStatus(id: string, patch: {
    status: PosPaymentStatus;
    provider_transaction_id?: string | null;
    provider_response?: unknown;
    payment_id?: string | null;
    sale_id?: string | null;
    needs_review?: boolean;
    review_reason?: string | null;
    completed?: boolean;
  }): Promise<PosPaymentRequest | null> {
    const { rows } = await pool.query(
      `UPDATE pos_payment_requests SET
         status = $2,
         provider_transaction_id = COALESCE($3, provider_transaction_id),
         provider_response = COALESCE($4::jsonb, provider_response),
         payment_id = COALESCE($5, payment_id),
         sale_id = COALESCE($6, sale_id),
         needs_review = COALESCE($7, needs_review),
         review_reason = COALESCE($8, review_reason),
         completed_at = CASE WHEN $9 THEN NOW() ELSE completed_at END
       WHERE id = $1 AND status = ANY($10::text[])
       RETURNING *`,
      [
        id, patch.status, patch.provider_transaction_id ?? null,
        patch.provider_response ? JSON.stringify(patch.provider_response) : null,
        patch.payment_id ?? null, patch.sale_id ?? null,
        patch.needs_review ?? null, patch.review_reason ?? null,
        !!patch.completed, NON_TERMINAL_STATUSES,
      ],
    );
    return rows[0] ?? null;
  },

  /** For pos-payments.scheduler.ts — actively poll anything still open past a short window. */
  async listNonTerminalOlderThan(minutesAgo: number): Promise<PosPaymentRequest[]> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests
       WHERE status = ANY($1::text[]) AND created_at < NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at ASC LIMIT 200`,
      [NON_TERMINAL_STATUSES, minutesAgo],
    );
    return rows;
  },

  /** For pos-payments.scheduler.ts — expire anything abandoned past its expires_at. */
  async listExpirable(): Promise<PosPaymentRequest[]> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests
       WHERE status = ANY($1::text[]) AND expires_at IS NOT NULL AND expires_at < NOW()
       ORDER BY created_at ASC LIMIT 200`,
      [NON_TERMINAL_STATUSES],
    );
    return rows;
  },

  /**
   * Unconditional — used only AFTER a caller has already won the atomic
   * SUCCESS transition above, to attach the resulting payment/sale ids.
   * No status guard needed: only the transition's winner ever reaches this.
   */
  async attachPaymentId(id: string, paymentId: string, saleId: string | null): Promise<void> {
    await pool.query(
      `UPDATE pos_payment_requests SET payment_id = $2, sale_id = COALESCE($3, sale_id) WHERE id = $1`,
      [id, paymentId, saleId],
    );
  },

  /**
   * Unconditional — flags a request for manual review regardless of its
   * current status. Used when a confirmed SUCCESS lands on an already-
   * CANCELLED/FAILED/EXPIRED request: money may have actually arrived, so
   * this must never be silently discarded OR silently double-credited.
   */
  async flagNeedsReview(id: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE pos_payment_requests SET needs_review = true, review_reason = $2 WHERE id = $1`,
      [id, reason],
    );
  },

  async addEvent(requestId: string, eventType: string, fromStatus: string | null, toStatus: string | null, rawPayload?: unknown): Promise<void> {
    await pool.query(
      `INSERT INTO pos_payment_events (pos_payment_request_id, event_type, from_status, to_status, raw_payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [requestId, eventType, fromStatus, toStatus, rawPayload ? JSON.stringify(rawPayload) : null],
    );
  },

  async listEvents(requestId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_events WHERE pos_payment_request_id = $1 ORDER BY created_at ASC`,
      [requestId],
    );
    return rows;
  },
};
