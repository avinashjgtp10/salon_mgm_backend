import type { PoolClient } from 'pg';
import { AppError } from '../../middleware/error.middleware';
import { NON_TERMINAL_STATUSES, PosPaymentRequest } from './pos-payments.types';
import { posPaymentsRepository } from './pos-payments.repository';

/** A provider-backed POS transaction is still open — the customer may yet be charged. */
export const POS_PAYMENT_UNRESOLVED = 'POS_PAYMENT_UNRESOLVED';
/**
 * A POS transaction is flagged for manual review (late success after a
 * cancel/expiry, a payment that couldn't be recorded, an amount mismatch…)
 * — money may already have been taken. Blocks until explicitly reconciled.
 */
export const POS_PAYMENT_NEEDS_REVIEW = 'POS_PAYMENT_NEEDS_REVIEW';

function blockingError(request: PosPaymentRequest): AppError {
  const open = NON_TERMINAL_STATUSES.includes(request.status);
  const details = {
    posPaymentRequestId: request.id,
    paymentReference: request.payment_reference,
    provider: request.provider,
    status: request.status,
    needsReview: request.needs_review,
    reviewReason: request.review_reason,
  };
  if (open) {
    return new AppError(
      409,
      `A Payment Machine transaction (${request.payment_reference}) for this appointment is still unresolved — ` +
        'check its status or cancel it before taking payment another way.',
      POS_PAYMENT_UNRESOLVED,
      details,
    );
  }
  return new AppError(
    409,
    `Payment Machine transaction ${request.payment_reference} (${request.status}) is flagged for review — money may ` +
      'already have been collected. Reconcile it before taking another payment for this appointment.',
    POS_PAYMENT_NEEDS_REVIEW,
    details,
  );
}

/**
 * Rejects (409) while the appointment has a POS transaction that must be
 * settled first: a provider-backed one still open (POS_PAYMENT_UNRESOLVED),
 * or any one flagged for review whatever its status
 * (POS_PAYMENT_NEEDS_REVIEW). A resolved transaction without a review flag
 * never blocks. `excludeRequestId` lets finalizeSuccess record the payment
 * of the very request it is finalizing.
 */
export async function assertNoBlockingPosPayment(
  appointmentId: string,
  salonId: string,
  options: { client?: PoolClient; excludeRequestId?: string | null } = {},
): Promise<void> {
  const blocking = await posPaymentsRepository.findBlockingForAppointment(appointmentId, salonId, options);
  if (blocking) throw blockingError(blocking);
}
