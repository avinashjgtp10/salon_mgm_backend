import type { PoolClient } from 'pg';
import pool from '../../config/database';
import { PosPaymentRequest, PosPaymentStatus, NON_TERMINAL_STATUSES, CreatePosPaymentBody } from './pos-payments.types';

// First key of the two-key advisory lock below — namespaces it so it can't
// collide with any other advisory lock keyed on hashtext() of some id.
const APPOINTMENT_PAYMENT_LOCK_NAMESPACE = 7301;

/** Thrown by create() when an open request for the appointment already exists. */
export class DuplicatePosRequestError extends Error {
  constructor(public readonly existing: PosPaymentRequest) {
    super(`A payment request (${existing.payment_reference}) is already in progress for this appointment`);
  }
}

export const posPaymentsRepository = {

  /**
   * Serializes everything that starts collecting money for one appointment
   * — a new POS request, or a Cash/Card/UPI payment — for the rest of the
   * caller's transaction. Without it, two concurrent attempts could both
   * pass their "anything blocking?" check before either commits.
   */
  async lockAppointmentPayments(appointmentId: string, client: PoolClient): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))', [APPOINTMENT_PAYMENT_LOCK_NAMESPACE, String(appointmentId)]);
  },

  /**
   * The same appointment lock, held by a dedicated connection until
   * release() — for payments.service create(), whose work (benefit
   * deductions, ledger writes, the payment row) spans many separate queries,
   * so a transaction-scoped lock can't cover it. Shares the lock key with
   * lockAppointmentPayments(), so a POS request waits for it and vice versa.
   * release() is idempotent; if unlocking fails the connection is destroyed
   * rather than returned to the pool still holding the lock.
   */
  async acquireAppointmentPaymentLock(appointmentId: string): Promise<{ release: () => Promise<void> }> {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1::int, hashtext($2::text))', [APPOINTMENT_PAYMENT_LOCK_NAMESPACE, String(appointmentId)]);
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock($1::int, hashtext($2::text))', [APPOINTMENT_PAYMENT_LOCK_NAMESPACE, String(appointmentId)]);
          client.release();
        } catch (err) {
          client.release(err as Error); // destroys the connection, which drops the lock
        }
      },
    };
  },

  /**
   * The request that blocks taking any other payment for the appointment:
   * a provider-backed request still open, or ANY request flagged for review
   * whatever its status (a late success after cancel/expiry, a payment that
   * couldn't be recorded, an amount mismatch…) until someone explicitly
   * reconciles it. Open requests sort first. `excludeRequestId` lets
   * finalizeSuccess record its own request's payment.
   */
  async findBlockingForAppointment(
    appointmentId: string,
    salonId: string,
    options: { client?: PoolClient; excludeRequestId?: string | null } = {},
  ): Promise<PosPaymentRequest | null> {
    const { rows } = await (options.client ?? pool).query(
      `SELECT * FROM pos_payment_requests
       WHERE appointment_id = $1 AND salon_id = $2
         AND ((status = ANY($3::text[]) AND provider <> 'manual') OR needs_review)
         AND ($4::uuid IS NULL OR id <> $4::uuid)
       ORDER BY (status = ANY($3::text[])) DESC, created_at DESC
       LIMIT 1`,
      [appointmentId, salonId, NON_TERMINAL_STATUSES, options.excludeRequestId ?? null],
    );
    return rows[0] ?? null;
  },

  /**
   * Explicit reconciliation only — clears the review flag on a request that
   * has reached a terminal status. Never called automatically; the original
   * review_reason and the event trail are kept.
   */
  async clearReviewFlag(id: string, salonId: string): Promise<PosPaymentRequest | null> {
    const { rows } = await pool.query(
      `UPDATE pos_payment_requests SET needs_review = false
       WHERE id = $1 AND salon_id = $2 AND needs_review AND NOT (status = ANY($3::text[]))
       RETURNING *`,
      [id, salonId, NON_TERMINAL_STATUSES],
    );
    return rows[0] ?? null;
  },

  /**
   * A provider-backed POS request for the appointment whose outcome is not
   * yet settled — pending, processing, or left open after an unconfirmed
   * cancel / deferred expiry / unknown outcome (those all stay non-terminal,
   * flagged for review). Manual-provider requests are excluded: they have no
   * external transaction and staff settle them locally.
   */
  async findUnresolvedForAppointment(appointmentId: string, salonId: string, client?: PoolClient): Promise<PosPaymentRequest | null> {
    const { rows } = await (client ?? pool).query(
      `SELECT * FROM pos_payment_requests
       WHERE appointment_id = $1 AND salon_id = $2 AND status = ANY($3::text[]) AND provider <> 'manual'
       ORDER BY created_at DESC LIMIT 1`,
      [appointmentId, salonId, NON_TERMINAL_STATUSES],
    );
    return rows[0] ?? null;
  },

  /**
   * Same atomic-sequence + SAVEPOINT-retry pattern as sales.repository.ts's
   * invoice-number generator (next_invoice_seq) — copied exactly, just
   * against next_payment_seq and the pos_payment_requests unique constraint.
   */
  async create(
    data: CreatePosPaymentBody & { provider: string },
    // Extra checks that must see a settled state (e.g. outstanding balance,
    // review flags) — run under the appointment lock, before anything is
    // written; throwing rolls the whole create back.
    guard?: (client: PoolClient) => Promise<void>,
  ): Promise<PosPaymentRequest> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Re-check the duplicate guard under the appointment lock — the
      // service's earlier check alone lets two concurrent creates both pass.
      await posPaymentsRepository.lockAppointmentPayments(data.appointment_id, client);
      const existing = await posPaymentsRepository.findNonTerminalForAppointment(data.appointment_id, data.salon_id, client);
      if (existing) throw new DuplicatePosRequestError(existing);
      if (guard) await guard(client);
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
  async findNonTerminalForAppointment(appointmentId: string, salonId: string, client?: PoolClient): Promise<PosPaymentRequest | null> {
    const { rows } = await (client ?? pool).query(
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

  /**
   * For pos-payments.scheduler.ts — anything open past its expires_at.
   * Provider-backed requests already flagged for review were deferred (not
   * expired) by an earlier final check and stay open; excluding them keeps
   * them from filling the oldest-first LIMIT and starving newer requests.
   */
  async listExpirable(): Promise<PosPaymentRequest[]> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_payment_requests
       WHERE status = ANY($1::text[]) AND expires_at IS NOT NULL AND expires_at < NOW()
         AND NOT (needs_review AND provider <> 'manual')
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
