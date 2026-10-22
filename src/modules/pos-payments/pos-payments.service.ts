import logger from '../../config/logger';
import { AppError } from '../../middleware/error.middleware';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { appointmentsService } from '../appointments/appointments.service';
import { paymentsService } from '../payments/payments.service';
import { paymentSettingsRepository } from '../payment-settings/payment-settings.repository';
import { DuplicatePosRequestError, posPaymentsRepository } from './pos-payments.repository';
import { providerFactory } from './providers/provider.factory';
import { buildTxnContext, toRequestedAt } from './pos-payments.txn-context';
import { assertNoBlockingPosPayment } from './pos-payments.guard';
import { assertPosAmountWithinOutstanding } from './pos-payments.balance';
import { CreatePosPaymentBody, NON_TERMINAL_STATUSES, PosPaymentRequest, PosPaymentStatus, PosProviderId } from './pos-payments.types';
import { PaymentProvider, ProviderCancelResult, ProviderStatusResult, ProviderTxnContext } from './providers/provider.types';

const AMOUNT_TOLERANCE = 0.5; // rupees — guards against float/rounding noise, not real mismatches
// Provider statuses that prove no money moved — the only basis for marking a
// provider-backed request CANCELLED.
const DEFINITIVE_NOT_PAID: PosPaymentStatus[] = ['FAILED', 'CANCELLED', 'EXPIRED'];

export const posPaymentsService = {

  async create(params: {
    salonId: string;
    branchId?: string;
    appointmentId: string;
    clientId?: string;
    terminalId?: string;
    provider: PosProviderId;
    amount: number;
    payload: CreatePosPaymentBody['payload'];
    requesterUserId: string;
  }): Promise<PosPaymentRequest> {
    const { salonId, appointmentId, requesterUserId } = params;

    const appt = await appointmentsRepository.findById(appointmentId);
    if (!appt || String((appt as any).salon_id) !== String(salonId)) {
      throw new AppError(404, 'Appointment not found', 'NOT_FOUND');
    }

    // Duplicate-payment guard — payments.service.ts has no such guard itself,
    // it would just insert a second payments row if called twice.
    const existing = await posPaymentsRepository.findNonTerminalForAppointment(appointmentId, salonId);
    if (existing) {
      throw new AppError(409, `A payment request (${existing.payment_reference}) is already in progress for this appointment`, 'DUPLICATE_REQUEST');
    }

    let terminalProviderId: string | null = null;
    if (params.terminalId) {
      const terminal = await paymentSettingsRepository.findTerminalById(params.terminalId, salonId);
      if (!terminal || !terminal.is_active) throw new AppError(400, 'Selected terminal is not available', 'TERMINAL_UNAVAILABLE');
      // Branch scoping — skip the check when either side has no branch_id
      // (single-branch salons never backfilled one), only enforce when both
      // are known and actually differ.
      if (terminal.branch_id && appt.branch_id && String(terminal.branch_id) !== String(appt.branch_id)) {
        throw new AppError(400, 'Selected terminal belongs to a different branch', 'TERMINAL_BRANCH_MISMATCH');
      }
      terminalProviderId = terminal.provider_terminal_id;
    }

    let request: PosPaymentRequest;
    try {
      request = await posPaymentsRepository.create({
        salon_id: salonId,
        branch_id: params.branchId ?? appt.branch_id ?? undefined,
        appointment_id: appointmentId,
        client_id: params.clientId,
        terminal_id: params.terminalId ?? null,
        provider: params.provider,
        amount: params.amount,
        payload: params.payload,
        created_by: requesterUserId,
      }, async (client) => {
        // Under the appointment payment lock, so no other payment can land
        // between these checks and the request being created.
        await assertNoBlockingPosPayment(appointmentId, salonId, { client });
        await assertPosAmountWithinOutstanding(appointmentId, salonId, params.amount, params.payload);
      });
    } catch (err) {
      // Lost a race with a concurrent create — same answer as the check above.
      if (err instanceof DuplicatePosRequestError) {
        throw new AppError(409, `A payment request (${err.existing.payment_reference}) is already in progress for this appointment`, 'DUPLICATE_REQUEST');
      }
      throw err;
    }
    await posPaymentsRepository.addEvent(request.id, 'CREATED', null, 'PENDING', { provider: params.provider });

    try {
      const provider = await providerFactory.getProvider(salonId, params.provider);
      const result = await provider.createPayment({
        reference: request.payment_reference,
        amount: request.amount,
        currency: request.currency,
        terminalProviderId,
        requestedAt: toRequestedAt(request.created_at),
      });
      const updated = await posPaymentsRepository.transitionStatus(request.id, {
        status: result.status,
        provider_transaction_id: result.providerTransactionId,
        provider_response: result.raw,
      });
      await posPaymentsRepository.addEvent(request.id, 'PROVIDER_ACK', 'PENDING', updated?.status ?? result.status, result.raw);
      return updated ?? request;
    } catch (err: any) {
      logger.error('[pos-payments] provider createPayment failed', { requestId: request.id, message: err?.message });
      const failed = await posPaymentsRepository.transitionStatus(request.id, {
        status: 'FAILED',
        review_reason: `Provider create failed: ${err?.message ?? 'unknown error'}`,
      });
      await posPaymentsRepository.addEvent(request.id, 'ERROR', 'PENDING', 'FAILED', { message: err?.message });
      return failed ?? request;
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
    if (!unresolved) return null;
    return posPaymentsService.getStatus(unresolved.id, salonId);
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
        const provider = await providerFactory.getProvider(salonId, request.provider);
        const live = await provider.getPaymentStatus(await buildTxnContext(request));
        request = await posPaymentsService.applyProviderStatus(request, live);
      } catch (err: any) {
        logger.warn('[pos-payments] poll-through status check failed', { requestId: id, message: err?.message });
      }
    }
    return request;
  },

  /** Shared by getStatus's poll-through and the scheduler's sweep. */
  async applyProviderStatus(request: PosPaymentRequest, live: { status: PosPaymentStatus; providerTransactionId: string | null; amount?: number | null; raw: unknown }): Promise<PosPaymentRequest> {
    if (live.status === 'SUCCESS') {
      return posPaymentsService.finalizeSuccess(request, live.providerTransactionId, live.amount ?? request.amount, live.raw);
    }
    if (live.status === request.status) return request; // no change
    if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(live.status)) {
      const updated = await posPaymentsRepository.transitionStatus(request.id, {
        status: live.status,
        provider_transaction_id: live.providerTransactionId,
        provider_response: live.raw,
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
   * The one place a request becomes SUCCESS and money actually moves.
   * Idempotent (duplicate calls/webhooks/polls are safe) and amount-checked.
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
      // request is a harmless no-op; landing on CANCELLED/FAILED/EXPIRED
      // means money may have actually arrived after the fact — flag it
      // rather than silently discarding or double-crediting.
      const current = await posPaymentsRepository.findById(request.id, request.salon_id);
      if (current && current.status !== 'SUCCESS') {
        await posPaymentsRepository.flagNeedsReview(
          request.id,
          `Provider confirmed SUCCESS after the request was already ${current.status} — needs manual reconciliation.`,
        );
        await posPaymentsRepository.addEvent(request.id, 'LATE_SUCCESS_AFTER_TERMINAL', current.status, current.status, providerResponse);
      }
      return current ?? request;
    }

    await posPaymentsRepository.addEvent(request.id, 'STATUS_CHANGED', request.status, 'SUCCESS', providerResponse);

    // Replay the exact payload the frontend already built into the one live
    // payment-write path — every existing side effect (tax/wallet/commission/
    // receipts/package redemption) fires exactly as it does for Cash/Card/UPI.
    try {
      // Identifies this request to the payments guard, so its own review flag
      // (e.g. it was deferred at expiry before confirming) doesn't block
      // recording the payment it just confirmed.
      const payment = await paymentsService.create(request.payload, request.created_by ?? undefined, { posPaymentRequestId: request.id });
      let saleId: string | null = null;
      if (Number(payment.due_amount) === 0 && request.appointment_id) {
        try {
          const checkoutResult = await appointmentsService.checkout({
            appointmentId: request.appointment_id,
            requesterUserId: request.created_by ?? '',
            requesterRole: undefined,
            saleItems: [],
          });
          saleId = checkoutResult?.saleId ?? null;
        } catch (err: any) {
          // Matches the frontend's own fire-and-forget behavior for this same
          // call (usePayment.ts dispatches checkoutBookingThunk and swallows
          // errors) — the payment itself must never be undone by this failing.
          logger.warn('[pos-payments] post-success checkout (commission) failed', { requestId: request.id, message: err?.message });
        }
      }
      await posPaymentsRepository.attachPaymentId(request.id, payment.id, saleId);
      await posPaymentsRepository.addEvent(request.id, 'CONFIRMED', 'SUCCESS', 'SUCCESS', { paymentId: payment.id, saleId });
    } catch (err: any) {
      // The provider genuinely took the money and we already committed
      // SUCCESS — this must surface loudly for manual reconciliation rather
      // than silently leaving a confirmed payment with no payments row.
      logger.error('[pos-payments] CRITICAL: provider confirmed SUCCESS but replaying into payments.service.create() failed', { requestId: request.id, message: err?.message });
      await posPaymentsRepository.flagNeedsReview(request.id, `Provider confirmed payment but recording it failed: ${err?.message ?? 'unknown error'} — needs manual payment entry.`);
      await posPaymentsRepository.addEvent(request.id, 'ERROR', 'SUCCESS', 'SUCCESS', { message: err?.message });
    }

    return (await posPaymentsRepository.findById(request.id, request.salon_id)) ?? claimed;
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
      provider = await providerFactory.getProvider(salonId, request.provider);
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
        `Cancel requested but ${request.provider} has not confirmed the outcome (${details}) — not cancelled. ` +
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
