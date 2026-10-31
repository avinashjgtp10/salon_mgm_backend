import logger from '../../config/logger';
import { withPoolTransaction } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { appointmentsService } from '../appointments/appointments.service';
import { paymentsService } from '../payments/payments.service';
import { paymentSettingsRepository } from '../payment-settings/payment-settings.repository';
import { DuplicatePosRequestError, posPaymentsRepository } from './pos-payments.repository';
import { providerFactory } from './providers/provider.factory';
import { buildTxnContext, toRequestedAt } from './pos-payments.txn-context';
import { assertNoBlockingPosPayment } from './pos-payments.guard';
import { assertPosAmountMatchesPayload, assertPosAmountWithinOutstanding, resolvePosPaymentMode } from './pos-payments.balance';
import { paymentsRepository } from '../payments/payments.repository';
import {
  CreatePosPaymentBody, MAX_RECORD_ATTEMPTS, NON_TERMINAL_STATUSES, PosPaymentRequest, PosPaymentStatus, PosProviderId,
  REVIEW_CANCEL_UNCONFIRMED, REVIEW_EXPIRY_DEFERRED,
} from './pos-payments.types';
import {
  PaymentProvider, ProviderCancelResult, ProviderCreateResult, ProviderStatusResult, ProviderTxnContext,
} from './providers/provider.types';
import type { Payment } from '../payments/payments.types';

const AMOUNT_TOLERANCE = 0.5; // rupees — guards against float/rounding noise, not real mismatches
// Provider statuses that prove no money moved — the only basis for marking a
// provider-backed request CANCELLED.
const DEFINITIVE_NOT_PAID: PosPaymentStatus[] = ['FAILED', 'CANCELLED', 'EXPIRED'];

/** 409 for a second request while one is open — carries its id so the frontend can resume it. */
function duplicateRequestError(existing: PosPaymentRequest): AppError {
  return new AppError(
    409,
    `A payment request (${existing.payment_reference}) is already in progress for this appointment`,
    'DUPLICATE_REQUEST',
    { posPaymentRequestId: existing.id, paymentReference: existing.payment_reference, status: existing.status },
  );
}

/** Follow-up provider calls use the Live/Test mode the sale was sent in. */
function followUpProvider(request: PosPaymentRequest): Promise<PaymentProvider> {
  return providerFactory.getProvider(request.salon_id, request.provider, { environment: request.provider_environment ?? null });
}

/** Confirmed by the provider and still to be saved automatically. */
function needsRecording(request: PosPaymentRequest): boolean {
  return request.status === 'SUCCESS' && !request.payment_id && (request.record_attempts ?? 0) < MAX_RECORD_ATTEMPTS;
}

/**
 * Patch for a request settling as definitively not paid. A review flag that
 * only meant "outcome unknown" (unconfirmed cancel, inconclusive expiry check)
 * is answered by that, so it's cleared — otherwise it would keep blocking every
 * payment for the appointment forever. Any other flag is left for reconcile.
 */
function resolvedUnknownOutcomePatch(request: PosPaymentRequest, status: PosPaymentStatus): { needs_review?: boolean; review_reason?: string } {
  const reason = request.review_reason ?? '';
  if (!request.needs_review || !(reason.startsWith(REVIEW_CANCEL_UNCONFIRMED) || reason.startsWith(REVIEW_EXPIRY_DEFERRED))) return {};
  return {
    needs_review: false,
    review_reason: `${request.provider} later confirmed the payment was not taken (${status}) — no money was collected for this attempt.`,
  };
}

export const posPaymentsService = {

  async create(params: {
    salonId: string;
    branchId?: string;
    appointmentId: string;
    clientId?: string;
    terminalId?: string;
    provider: PosProviderId;
    // CARD (Card) / QR (UPI); derived from the payload's method when omitted.
    paymentMode?: string | null;
    amount: number;
    payload: CreatePosPaymentBody['payload'];
    requesterUserId: string;
  }): Promise<PosPaymentRequest> {
    const { salonId, appointmentId, requesterUserId } = params;
    // Replayed verbatim into paymentsService.create() on success — pin it to
    // the tenant and appointment that were actually checked, the same way
    // payments.controller.ts enforces salon_id from the JWT.
    const payload = { ...params.payload, salon_id: salonId, appointment_id: appointmentId };
    const paymentMode = resolvePosPaymentMode(payload, params.paymentMode);
    assertPosAmountMatchesPayload(params.amount, payload);

    const appt = await appointmentsRepository.findById(appointmentId);
    if (!appt || String((appt as any).salon_id) !== String(salonId)) {
      throw new AppError(404, 'Appointment not found', 'NOT_FOUND');
    }

    // Everything the machine needs is checked before anything is written, so
    // a refusal here leaves no request behind and nothing is sent.
    let environment: string | null = null;
    if (params.provider !== 'manual') {
      const config = await paymentSettingsRepository.findProviderConfig(salonId, params.provider);
      if (!config?.is_enabled) {
        throw new AppError(400, 'The payment machine is turned off in Settings — choose "Payment collected elsewhere" or another method.', 'PROVIDER_NOT_CONFIGURED');
      }
      environment = config.environment === 'production' ? 'production' : 'sandbox';
      if (!params.terminalId) throw new AppError(400, 'Choose which payment machine to use', 'TERMINAL_REQUIRED');
    }

    // Duplicate-payment guard — payments.service.ts has no such guard itself,
    // it would just insert a second payments row if called twice.
    const existing = await posPaymentsRepository.findNonTerminalForAppointment(appointmentId, salonId);
    if (existing) throw duplicateRequestError(existing);

    let terminalProviderId: string | null = null;
    if (params.terminalId) {
      const terminal = await paymentSettingsRepository.findTerminalById(params.terminalId, salonId);
      if (!terminal || !terminal.is_active) throw new AppError(400, 'Selected terminal is not available', 'TERMINAL_UNAVAILABLE');
      if (terminal.provider !== params.provider) {
        throw new AppError(400, `Selected terminal isn't a ${params.provider} machine`, 'TERMINAL_UNAVAILABLE');
      }
      // Branch scoping — skip the check when either side has no branch_id
      // (single-branch salons never backfilled one), only enforce when both
      // are known and actually differ.
      if (terminal.branch_id && appt.branch_id && String(terminal.branch_id) !== String(appt.branch_id)) {
        throw new AppError(400, 'Selected terminal belongs to a different branch', 'TERMINAL_BRANCH_MISMATCH');
      }
      terminalProviderId = terminal.provider_terminal_id?.trim() || null;
      if (params.provider === 'paytm' && !terminalProviderId) {
        throw new AppError(400, 'This payment machine has no TID — add it in Settings → POS / Payment Machine', 'TERMINAL_UNAVAILABLE');
      }
    }

    let request: PosPaymentRequest;
    try {
      request = await posPaymentsRepository.create({
        salon_id: salonId,
        branch_id: params.branchId ?? appt.branch_id ?? undefined,
        appointment_id: appointmentId,
        client_id: params.clientId,
        terminal_id: params.terminalId ?? null,
        payment_mode: paymentMode,
        // Snapshots: status checks and cancels keep addressing this exact
        // machine and server even if Settings change mid-payment.
        provider_terminal_id: terminalProviderId,
        provider_environment: environment,
        provider: params.provider,
        amount: params.amount,
        payload,
        created_by: requesterUserId,
      }, async (client) => {
        // Under the appointment payment lock, so no other payment can land
        // between these checks and the request being created.
        await assertNoBlockingPosPayment(appointmentId, salonId, { client });
        await assertPosAmountWithinOutstanding(appointmentId, salonId, params.amount, payload);
      });
    } catch (err) {
      // Lost a race with a concurrent create — same answer as the check above.
      if (err instanceof DuplicatePosRequestError) throw duplicateRequestError(err.existing);
      throw err;
    }
    await posPaymentsRepository.addEvent(request.id, 'CREATED', null, 'PENDING', { provider: params.provider, paymentMode });

    // 1. Send the Sale. Only a throw from HERE may mark the request FAILED:
    //    the provider throws only when nothing reached the machine (invalid
    //    input, could not connect) or the provider explicitly refused it.
    let result: ProviderCreateResult;
    try {
      // The environment checked above, so the Sale goes where the snapshot says.
      const provider = await providerFactory.getProvider(salonId, params.provider, { environment });
      result = await provider.createPayment({
        reference: request.payment_reference,
        amount: request.amount,
        currency: request.currency,
        terminalProviderId,
        requestedAt: toRequestedAt(request.created_at),
        paymentMode,
      });
    } catch (err: any) {
      logger.error('[pos-payments] provider createPayment failed — nothing reached the machine', { requestId: request.id, message: err?.message });
      const failed = await posPaymentsRepository.transitionStatus(request.id, {
        status: 'FAILED',
        review_reason: `Provider create failed: ${err?.message ?? 'unknown error'}`,
      });
      await posPaymentsRepository.addEvent(request.id, 'ERROR', 'PENDING', 'FAILED', { message: err?.message }).catch(() => undefined);
      return failed ?? request;
    }

    // 2. The provider answered — the machine may now be taking the money.
    //    Failing to save that answer must never turn into FAILED: the request
    //    stays open (PENDING), keeps blocking any other payment, and status
    //    checks / the scheduler resolve its real outcome from Paytm.
    try {
      const updated = await posPaymentsRepository.transitionStatus(request.id, {
        status: result.status,
        provider_transaction_id: result.providerTransactionId,
        provider_response: result.raw,
        // Shown on the POS modal's "Payment Failed" screen (review_reason).
        review_reason: result.status === 'FAILED' ? `Payment machine rejected the request: ${result.failureReason ?? 'no reason given'}` : null,
      });
      await posPaymentsRepository.addEvent(request.id, 'PROVIDER_ACK', 'PENDING', updated?.status ?? result.status, result.raw)
        .catch((err: any) => logger.warn('[pos-payments] could not log PROVIDER_ACK', { requestId: request.id, message: err?.message }));
      return updated ?? request;
    } catch (err: any) {
      logger.error('[pos-payments] provider answered but saving its answer failed — left open for status checks', {
        requestId: request.id, providerStatus: result.status, message: err?.message,
      });
      return (await posPaymentsRepository.findById(request.id, salonId).catch(() => null)) ?? request;
    }
  },

  /**
   * The appointment's unresolved provider-backed POS request, refreshed
   * through the normal poll-through (so it may come back resolved), or null.
   * Lets a reopened appointment resume the existing transaction instead of
   * starting another payment.
   */
  async getActiveForAppointment(appointmentId: string, salonId: string): Promise<PosPaymentRequest | null> {
    const unresolved = await posPaymentsRepository.findUnresolvedForAppointment(appointmentId, salonId);
    if (unresolved) return posPaymentsService.getStatus(unresolved.id, salonId);
    // A settled request still flagged for review blocks every payment too
    // (POS_PAYMENT_NEEDS_REVIEW) — return it so the frontend can show why and
    // offer reconcile, instead of the appointment silently refusing payments.
    return posPaymentsRepository.findBlockingForAppointment(appointmentId, salonId);
  },

  async getStatus(id: string, salonId: string): Promise<PosPaymentRequest> {
    let request = await posPaymentsRepository.findById(id, salonId);
    if (!request) throw new AppError(404, 'Payment request not found', 'NOT_FOUND');

    const nonTerminal = request.status === 'PENDING' || request.status === 'PROCESSING';
    if (nonTerminal && request.provider !== 'manual') {
      // Poll-through: check the live provider before responding, not just a
      // DB read — this is the primary confirmation path for providers with
      // no webhook (Paytm today). The scheduler covers the case where no one
      // is polling from the frontend at all (closed tab).
      try {
        const provider = await followUpProvider(request);
        const live = await provider.getPaymentStatus(await buildTxnContext(request));
        request = await posPaymentsService.applyProviderStatus(request, live);
      } catch (err: any) {
        logger.warn('[pos-payments] poll-through status check failed', { requestId: id, message: err?.message });
      }
    } else if (needsRecording(request)) {
      // Paid, not yet saved (an earlier attempt hit a database error, or the
      // server restarted in between) — retry while someone is watching.
      request = await posPaymentsService.recordConfirmedPayment(request);
    }
    return request;
  },

  /** Shared by getStatus's poll-through and the scheduler's sweep. */
  async applyProviderStatus(request: PosPaymentRequest, live: { status: PosPaymentStatus; providerTransactionId: string | null; amount?: number | null; failureReason?: string | null; raw: unknown }): Promise<PosPaymentRequest> {
    if (live.status === 'SUCCESS') {
      return posPaymentsService.finalizeSuccess(request, live.providerTransactionId, live.amount ?? request.amount, live.raw);
    }
    if (live.status === request.status) return request; // no change
    if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(live.status)) {
      const resolved = resolvedUnknownOutcomePatch(request, live.status);
      const updated = await posPaymentsRepository.transitionStatus(request.id, {
        status: live.status,
        provider_transaction_id: live.providerTransactionId,
        provider_response: live.raw,
        ...resolved,
        // e.g. card declined / timed out on the machine — shown to staff.
        review_reason: live.status === 'FAILED' && live.failureReason
          ? `Payment failed on the machine: ${live.failureReason}`
          : resolved.review_reason ?? null,
      });
      if (updated) await posPaymentsRepository.addEvent(request.id, 'STATUS_CHANGED', request.status, live.status, live.raw);
      return updated ?? request;
    }
    // PROCESSING — just record the ack, no status flip needed if already PROCESSING
    const updated = await posPaymentsRepository.transitionStatus(request.id, {
      status: live.status,
      provider_transaction_id: live.providerTransactionId,
      provider_response: live.raw,
    });
    return updated ?? request;
  },

  /**
   * The one place a request becomes SUCCESS. Idempotent (duplicate calls/
   * webhooks/polls are safe) and amount-checked. SUCCESS is committed first
   * — it's the durable record that the customer paid — then the payment is
   * saved by recordConfirmedPayment, which recovery retries if this process
   * dies or the database fails in between.
   */
  async finalizeSuccess(request: PosPaymentRequest, providerTransactionId: string | null, confirmedAmount: number, providerResponse: unknown): Promise<PosPaymentRequest> {
    if (Math.abs(Number(confirmedAmount) - Number(request.amount)) > AMOUNT_TOLERANCE) {
      await posPaymentsRepository.flagNeedsReview(
        request.id,
        `Provider confirmed ₹${confirmedAmount} but request was for ₹${request.amount} — not auto-completed, needs manual reconciliation.`,
      );
      await posPaymentsRepository.addEvent(request.id, 'AMOUNT_MISMATCH', request.status, request.status, providerResponse);
      return (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? request;
    }

    const claimed = await posPaymentsRepository.transitionStatus(request.id, {
      status: 'SUCCESS',
      provider_transaction_id: providerTransactionId,
      provider_response: providerResponse,
      completed: true,
    });

    if (!claimed) {
      // Already terminal. A duplicate SUCCESS landing on an already-SUCCESS
      // request only needs its payment saved if that hasn't happened yet;
      // landing on CANCELLED/FAILED/EXPIRED means money may have actually
      // arrived after the fact — flag it rather than silently discarding or
      // double-crediting.
      const current = await posPaymentsRepository.findById(request.id, request.salon_id);
      if (current?.status === 'SUCCESS') {
        return needsRecording(current) ? posPaymentsService.recordConfirmedPayment(current) : current;
      }
      if (current) {
        await posPaymentsRepository.flagNeedsReview(
          request.id,
          `Provider confirmed SUCCESS after the request was already ${current.status} — needs manual reconciliation.`,
        );
        await posPaymentsRepository.addEvent(request.id, 'LATE_SUCCESS_AFTER_TERMINAL', current.status, current.status, providerResponse);
      }
      return current ?? request;
    }

    await posPaymentsRepository.addEvent(request.id, 'STATUS_CHANGED', request.status, 'SUCCESS', providerResponse);
    return posPaymentsService.recordConfirmedPayment(claimed);
  },

  /**
   * Saves a provider-confirmed payment — exactly once, all or nothing.
   * Replays the exact payload the frontend built into the one live
   * payment-write path, so every existing side effect (tax/wallet/sale/
   * packages/receipts) fires as it does for Cash/Card/UPI — but the whole
   * of it runs as ONE database transaction (withPoolTransaction): the
   * payment row, eWallet / referral / reward-point ledgers, the sale,
   * memberships, packages, appointment status… commit together or not at
   * all. A crash or database failure part-way therefore leaves nothing
   * half-done, and the retry simply runs it again from the start.
   *
   * Safe to call any number of times, concurrently, and after a crash: the
   * transaction holds the appointment lock until it commits, and
   * payments.service create() returns the row already saved for this
   * request instead of writing a second one (backed by a unique index).
   * Messages sent along the way (WhatsApp, sockets) are not rolled back and
   * may repeat on a retry.
   *
   * A failure (e.g. the database is down) is counted and retried by the next
   * status poll or scheduler sweep; after MAX_RECORD_ATTEMPTS the request is
   * flagged for a person to reconcile. Either way it keeps blocking any
   * other payment for the appointment, since the customer has already paid.
   */
  async recordConfirmedPayment(request: PosPaymentRequest): Promise<PosPaymentRequest> {
    if (!needsRecording(request)) return request;

    let payment: Payment;
    try {
      payment = await withPoolTransaction(async () => {
        if (request.appointment_id) await posPaymentsRepository.lockAppointmentPaymentsForTransaction(request.appointment_id);
        return paymentsService.create(
          { ...request.payload, salon_id: request.salon_id, appointment_id: request.appointment_id ?? undefined },
          request.created_by ?? undefined,
          { posPaymentRequestId: request.id },
        );
      });
    } catch (err: any) {
      const message = err?.message ?? 'unknown error';
      const failed = await posPaymentsRepository.recordAttemptFailed(request.id, message);
      const attempts = failed?.record_attempts ?? (request.record_attempts ?? 0) + 1;
      await posPaymentsRepository.addEvent(request.id, 'RECORD_FAILED', 'SUCCESS', 'SUCCESS', { message, attempts });
      if (attempts >= MAX_RECORD_ATTEMPTS) {
        logger.error('[pos-payments] CRITICAL: provider confirmed payment but saving it keeps failing — needs manual entry', { requestId: request.id, attempts, message });
        await posPaymentsRepository.flagNeedsReview(
          request.id,
          `The customer paid on the machine but saving the payment failed ${attempts} times (${message}). ` +
            'Do NOT charge again — record this payment by hand, then reconcile.',
        );
      } else {
        logger.warn('[pos-payments] saving a confirmed payment failed — will retry', { requestId: request.id, attempts, message });
      }
      return (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? request;
    }

    const attached = await posPaymentsRepository.attachPaymentId(request.id, payment.id);
    if (attached) {
      await posPaymentsRepository.addEvent(request.id, 'CONFIRMED', 'SUCCESS', 'SUCCESS', { paymentId: payment.id });
      await posPaymentsService.settleCheckout(attached, payment);
    }
    // Not attached → a concurrent recorder linked the same row first; it settles checkout.
    return (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? attached ?? request;
  },

  /**
   * The post-payment step for a saved machine payment: checkout (sale +
   * commission + completed appointment) only when this payment leaves
   * nothing due. A partial payment keeps the rest due and never checks out.
   * Runs under the appointment payment lock so the inline call and a
   * recovery sweep can't both check out the same appointment; a failure is
   * retried by the sweep (checkout_settled_at stays unset).
   */
  async settleCheckout(request: PosPaymentRequest, savedPayment?: Payment | null): Promise<void> {
    if (request.status !== 'SUCCESS' || !request.payment_id || request.checkout_settled_at || !request.appointment_id) return;
    const lock = await posPaymentsRepository.acquireAppointmentPaymentLock(request.appointment_id);
    try {
      const current = await posPaymentsRepository.findById(request.id, request.salon_id);
      if (!current || current.checkout_settled_at) return;

      const payment = savedPayment ?? await paymentsRepository.findByPosPaymentRequestId(request.id);
      if (!payment) return;
      const fullyPaid = Number(payment.due_amount) <= 0.009 && payment.status !== 'partial';
      if (!fullyPaid) {
        await posPaymentsRepository.markCheckoutSettled(request.id, null);
        await posPaymentsRepository.addEvent(request.id, 'CHECKOUT_SKIPPED', 'SUCCESS', 'SUCCESS', { reason: 'partial payment', dueAmount: payment.due_amount });
        return;
      }
      try {
        const result = await appointmentsService.checkout({
          appointmentId: request.appointment_id,
          requesterUserId: request.created_by ?? '',
          requesterRole: undefined,
          saleItems: [],
        });
        await posPaymentsRepository.markCheckoutSettled(request.id, result?.saleId ?? null);
        await posPaymentsRepository.addEvent(request.id, 'CHECKED_OUT', 'SUCCESS', 'SUCCESS', { saleId: result?.saleId ?? null });
      } catch (err: any) {
        // The payment itself is saved and must never be undone by this — the
        // recovery sweep retries checkout.
        logger.warn('[pos-payments] post-payment checkout failed — will retry', { requestId: request.id, message: err?.message });
        await posPaymentsRepository.addEvent(request.id, 'CHECKOUT_FAILED', 'SUCCESS', 'SUCCESS', { message: err?.message });
      }
    } finally {
      await lock.release();
    }
  },

  async cancel(id: string, salonId: string): Promise<PosPaymentRequest> {
    const request = await posPaymentsRepository.findById(id, salonId);
    if (!request) throw new AppError(404, 'Payment request not found', 'NOT_FOUND');
    if (request.status !== 'PENDING' && request.status !== 'PROCESSING') {
      throw new AppError(400, `Cannot cancel a request in status ${request.status}`, 'BAD_REQUEST');
    }

    if (request.provider === 'manual') {
      return posPaymentsService.markCancelled(request, null);
    }

    // Provider-backed: an accepted abort, or a failed call, says nothing
    // about whether the customer paid. Only the provider's status can.
    //   1. status first — already paid → finalize instead of cancelling;
    //   2. abort;
    //   3. status again — CANCELLED only on a definitive "not paid".
    // Anything still open stays open, flagged for reconciliation, which
    // also keeps the duplicate-payment guard blocking a new request.
    let provider: PaymentProvider;
    let ctx: ProviderTxnContext;
    try {
      provider = await followUpProvider(request);
      ctx = await buildTxnContext(request);
    } catch (err: any) {
      logger.warn('[pos-payments] cancel: provider unavailable — not cancelled', { requestId: id, message: err?.message });
      return posPaymentsService.deferCancel(request, null, null, `provider unavailable: ${err?.message ?? 'unknown error'}`);
    }

    const before = await posPaymentsService.tryProviderStatus(request, provider, ctx);
    if (before?.status === 'SUCCESS') return posPaymentsService.applyProviderStatus(request, before);
    if (before && DEFINITIVE_NOT_PAID.includes(before.status)) return posPaymentsService.markCancelled(request, { status: before.raw });

    let abort: ProviderCancelResult;
    try {
      abort = await provider.cancelPayment(ctx);
    } catch (err: any) {
      abort = { outcome: 'UNKNOWN', raw: { error: err?.message ?? 'unknown error' } };
    }

    const after = await posPaymentsService.tryProviderStatus(request, provider, ctx);
    if (after?.status === 'SUCCESS') return posPaymentsService.applyProviderStatus(request, after);
    if (after && DEFINITIVE_NOT_PAID.includes(after.status)) {
      return posPaymentsService.markCancelled(request, { abort: abort.raw, status: after.raw });
    }
    return posPaymentsService.deferCancel(request, abort, after ?? before, after ? null : 'status check failed');
  },

  /** Status enquiry for cancel(): null (logged) on any error instead of throwing. */
  async tryProviderStatus(request: PosPaymentRequest, provider: PaymentProvider, ctx: ProviderTxnContext): Promise<ProviderStatusResult | null> {
    try {
      return await provider.getPaymentStatus(ctx);
    } catch (err: any) {
      logger.warn('[pos-payments] cancel: status check failed', { requestId: request.id, message: err?.message });
      return null;
    }
  },

  async markCancelled(request: PosPaymentRequest, providerResponse: unknown): Promise<PosPaymentRequest> {
    const updated = await posPaymentsRepository.transitionStatus(request.id, {
      status: 'CANCELLED',
      provider_response: providerResponse ?? undefined,
      ...resolvedUnknownOutcomePatch(request, 'CANCELLED'),
    });
    if (updated) await posPaymentsRepository.addEvent(request.id, 'CANCELLED', request.status, 'CANCELLED', providerResponse ?? undefined);
    // If the transition lost a race (e.g. a poll just confirmed SUCCESS),
    // return the current (now-SUCCESS) row rather than pretending it cancelled.
    return updated ?? (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? request;
  },

  /**
   * Cancel requested but the outcome is unconfirmed: not cancelled, not
   * failed. Stays non-terminal (still polled, still blocks a new request
   * for the appointment) and is flagged for review. Conditional on still
   * being open, so it can't overwrite a concurrent finalization.
   */
  async deferCancel(
    request: PosPaymentRequest,
    abort: ProviderCancelResult | null,
    lastStatus: ProviderStatusResult | null,
    note: string | null,
  ): Promise<PosPaymentRequest> {
    const details = [
      `abort: ${abort?.outcome ?? 'not sent'}${abort?.retryable ? ' (retryable)' : ''}`,
      `last status: ${lastStatus?.status ?? 'unknown'}`,
      ...(note ? [note] : []),
    ].join('; ');
    const updated = await posPaymentsRepository.transitionStatus(request.id, {
      status: request.status,
      needs_review: true,
      review_reason:
        `${REVIEW_CANCEL_UNCONFIRMED} ${request.provider} has not confirmed the outcome (${details}) — not cancelled. ` +
        'Verify on the terminal / provider dashboard; it stays open and is re-checked automatically.',
      provider_response: { abort: abort?.raw ?? null, status: lastStatus?.raw ?? null },
    });
    if (updated) {
      await posPaymentsRepository.addEvent(request.id, 'CANCEL_UNCONFIRMED', request.status, request.status, {
        abortOutcome: abort?.outcome ?? null,
        retryable: abort?.retryable ?? false,
        lastStatus: lastStatus?.status ?? null,
        note,
      });
      logger.warn('[pos-payments] cancel unconfirmed — left open for reconciliation', { requestId: request.id, details });
    }
    return updated ?? (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? request;
  },

  /** Manual provider only — staff types in the machine's printed transaction id. */
  async confirmManual(id: string, salonId: string, providerTransactionId: string): Promise<PosPaymentRequest> {
    const request = await posPaymentsRepository.findById(id, salonId);
    if (!request) throw new AppError(404, 'Payment request not found', 'NOT_FOUND');
    if (request.provider !== 'manual') throw new AppError(400, 'Only manual-provider requests can be confirmed this way', 'BAD_REQUEST');
    if (!providerTransactionId?.trim()) throw new AppError(400, 'A transaction id is required to confirm this payment', 'VALIDATION_ERROR');
    return posPaymentsService.finalizeSuccess(request, providerTransactionId.trim(), request.amount, { manuallyConfirmedBy: 'staff' });
  },

  /**
   * Explicit manual reconciliation of a request flagged for review, once
   * staff have verified it against the terminal / provider settlement (and,
   * if needed, recorded the payment by hand). Only for requests that have
   * reached a final status — an open one must be resolved via status/cancel
   * first. Clears needs_review only; review_reason and the event history
   * stay as the audit trail. Never invoked automatically.
   */
  async reconcileReview(id: string, salonId: string, userId: string, note: string): Promise<PosPaymentRequest> {
    const trimmedNote = String(note ?? '').trim();
    if (trimmedNote.length < 5) {
      throw new AppError(400, 'A reconciliation note (at least 5 characters) is required', 'VALIDATION_ERROR');
    }
    const request = await posPaymentsRepository.findById(id, salonId);
    if (!request) throw new AppError(404, 'Payment request not found', 'NOT_FOUND');
    if (!request.needs_review) throw new AppError(400, 'This payment request is not flagged for review', 'NOT_FLAGGED');
    if (NON_TERMINAL_STATUSES.includes(request.status)) {
      throw new AppError(409, 'This transaction is still open — check its status or cancel it before reconciling', 'POS_PAYMENT_UNRESOLVED');
    }
    // Still being saved automatically — recording it by hand now as well
    // would record the same payment twice.
    if (needsRecording(request)) {
      throw new AppError(409, 'This payment is still being saved automatically — wait for it to finish before reconciling', 'POS_PAYMENT_RECORDING');
    }

    const reconciled = await posPaymentsRepository.clearReviewFlag(id, salonId);
    if (!reconciled) {
      // Lost a race (already reconciled, or reopened) — report the current row.
      return (await posPaymentsRepository.findById(id, salonId)) ?? request;
    }
    await posPaymentsRepository.addEvent(id, 'REVIEW_RECONCILED', reconciled.status, reconciled.status, {
      reconciledBy: userId,
      note: trimmedNote,
      previousReviewReason: request.review_reason,
    });
    return reconciled;
  },

  async listEvents(id: string, salonId: string) {
    const request = await posPaymentsRepository.findById(id, salonId);
    if (!request) throw new AppError(404, 'Payment request not found', 'NOT_FOUND');
    return posPaymentsRepository.listEvents(id);
  },

  /**
   * Public-webhook orchestration — built for the abstraction; Paytm (the
   * only provider wired today) has none, so this path is currently unused
   * in production but ready for a future provider that does emit one.
   * Always resolves without throwing so the controller can respond 200
   * regardless of outcome (never give a provider a reason to hammer retries).
   */
  async handleWebhookEvent(providerId: PosProviderId, salonId: string, req: import('express').Request): Promise<void> {
    const provider = await providerFactory.getProvider(salonId, providerId);
    if (!provider.verifyWebhook(req)) {
      logger.warn('[pos-payments/webhook] signature verification failed', { providerId });
      return;
    }
    const event = provider.parseWebhook(req);
    if (!event.reference) return;

    // Tolerate a webhook arriving just before the create-request transaction
    // is visible — one short retry rather than dropping a real event.
    let request = await posPaymentsRepository.findByReference(event.reference, salonId);
    if (!request) {
      await new Promise((r) => setTimeout(r, 500));
      request = await posPaymentsRepository.findByReference(event.reference, salonId);
    }
    if (!request) {
      logger.warn('[pos-payments/webhook] no matching request for reference', { providerId, reference: event.reference });
      return;
    }

    await posPaymentsService.applyProviderStatus(request, {
      status: event.status,
      providerTransactionId: event.providerTransactionId,
      amount: event.amount ?? null,
      raw: event.raw,
    });
  },
};
