// ============================================================
// SalonOx — POS Payment Confirmation, Recovery & Expiry Scheduler
// ============================================================
// Paytm EDC (this repo's only wired live provider) has no documented
// webhook — confirmation for it is polling-only. The frontend already polls
// while a staff member is watching the waiting screen, but that stops the
// moment a tab closes; this sweep is what keeps a real in-flight payment
// from getting stranded when nobody's watching. It also:
//   - recovers payments the provider confirmed that were never saved (the
//     server restarted, or the database failed, in between) and checkouts
//     that never ran — runs on boot too, so a restart recovers them at once;
//   - handles requests that pass their expiry window: manual ones are
//     expired, provider-backed ones get one final status check first.

import logger from '../../config/logger';
import { posPaymentsRepository } from './pos-payments.repository';
import { posPaymentsService } from './pos-payments.service';
import { NON_TERMINAL_STATUSES, PosPaymentRequest, REVIEW_EXPIRY_DEFERRED } from './pos-payments.types';

const POLL_SWEEP_MINUTES_OLD = 0.5; // only sweep requests that have had at least ~30s to be created
const SWEEP_INTERVAL_MS = 45 * 1000;

let sweepInterval: NodeJS.Timeout | null = null;
// A sweep can outlast the interval (up to 200 requests × a 15s provider
// timeout), so overlapping runs are skipped rather than stacked. This is a
// per-process guard only — double finalization across processes, or against
// the frontend's poll-through, is prevented by the atomic conditional UPDATE
// in transitionStatus() that finalizeSuccess() must win first, and double
// recording by the unique payments.pos_payment_request_id.
let sweepInFlight = false;

async function runConfirmationSweep(): Promise<void> {
  const stale = await posPaymentsRepository.listNonTerminalOlderThan(POLL_SWEEP_MINUTES_OLD);
  for (const request of stale) {
    if (request.provider === 'manual') continue; // manual never auto-transitions
    try {
      await posPaymentsService.getStatus(request.id, request.salon_id);
    } catch (err: any) {
      logger.warn('[POS-PAYMENTS-SCHEDULER] confirmation poll failed', { requestId: request.id, message: err?.message });
    }
  }
}

/** Confirmed by the provider but never saved — save them now (exactly once). */
async function runRecordingSweep(): Promise<void> {
  const unrecorded = await posPaymentsRepository.listUnrecordedSuccess();
  for (const request of unrecorded) {
    try {
      const after = await posPaymentsService.recordConfirmedPayment(request);
      if (after.payment_id) logger.info(`[POS-PAYMENTS-SCHEDULER] recovered unsaved payment ${request.payment_reference}`);
    } catch (err: any) {
      logger.warn('[POS-PAYMENTS-SCHEDULER] recovering an unsaved payment failed', { requestId: request.id, message: err?.message });
    }
  }
}

/** Saved, but the post-payment checkout never finished — finish it. */
async function runCheckoutSweep(): Promise<void> {
  const pending = await posPaymentsRepository.listCheckoutPending();
  for (const request of pending) {
    try {
      await posPaymentsService.settleCheckout(request);
    } catch (err: any) {
      logger.warn('[POS-PAYMENTS-SCHEDULER] post-payment checkout retry failed', { requestId: request.id, message: err?.message });
    }
  }
}

/**
 * A provider-backed request past its expiry may still have been paid — an
 * earlier poll saying "pending" proves nothing about now. So before giving
 * up, run one final status check through the normal poll path (same
 * provider call, applyProviderStatus → finalizeSuccess, same atomic claims):
 *   - SUCCESS → finalized there, exactly once.
 *   - definitive FAILED/CANCELLED/EXPIRED → transitioned there.
 *   - still open (pending, retryable, unknown, network error) → NOT expired.
 *     Flagged for manual review and left non-terminal, so the confirmation
 *     sweep keeps polling it and staff can still cancel it explicitly.
 */
async function finalCheckBeforeExpiry(request: PosPaymentRequest): Promise<void> {
  const checked = await posPaymentsService.getStatus(request.id, request.salon_id);
  if (!NON_TERMINAL_STATUSES.includes(checked.status)) {
    logger.info(`[POS-PAYMENTS-SCHEDULER] ${request.payment_reference} resolved to ${checked.status} by final check at expiry`);
    return;
  }

  // Conditional on still being non-terminal, so a concurrent poll that just
  // finalized the request can't have a stale review flag written over it.
  const flagged = await posPaymentsRepository.transitionStatus(request.id, {
    status: checked.status,
    needs_review: true,
    review_reason:
      `${REVIEW_EXPIRY_DEFERRED} from ${request.provider} (last status ${checked.status}) — ` +
      'not expired automatically. Verify on the terminal / provider dashboard before cancelling or re-charging.',
  });
  if (flagged) {
    await posPaymentsRepository.addEvent(request.id, 'EXPIRY_DEFERRED', checked.status, checked.status, {
      reason: 'final status check inconclusive',
    });
    logger.warn(`[POS-PAYMENTS-SCHEDULER] ${request.payment_reference} unresolved at expiry — flagged for review, not expired`);
  }
}

async function runExpirySweep(): Promise<void> {
  const expirable = await posPaymentsRepository.listExpirable();
  for (const request of expirable) {
    try {
      if (request.provider !== 'manual') {
        // Already flagged → already deferred; the confirmation sweep keeps
        // polling it, so don't spend a second provider call every sweep.
        if (request.needs_review) continue;
        await finalCheckBeforeExpiry(request);
        continue;
      }
      const updated = await posPaymentsRepository.transitionStatus(request.id, { status: 'EXPIRED' });
      if (updated) {
        await posPaymentsRepository.addEvent(request.id, 'EXPIRED', request.status, 'EXPIRED');
        logger.info(`[POS-PAYMENTS-SCHEDULER] Expired abandoned request ${request.payment_reference}`);
      }
    } catch (err: any) {
      // Never expire on an error — the request stays as it is for the next sweep.
      logger.warn('[POS-PAYMENTS-SCHEDULER] expiry handling failed — left unchanged', { requestId: request.id, message: err?.message });
    }
  }
}

/**
 * One full sweep. Exported for tests; returns false when skipped because a
 * sweep is already running. Each stage is isolated, so one failing (e.g. a
 * missing migration column) never stops the others.
 */
export async function runPosPaymentsSweep(): Promise<boolean> {
  if (sweepInFlight) {
    logger.warn('[POS-PAYMENTS-SCHEDULER] previous sweep still running — skipping this tick');
    return false;
  }
  sweepInFlight = true;
  try {
    const stages: [string, () => Promise<void>][] = [
      ['confirmation', runConfirmationSweep],
      ['recording', runRecordingSweep],
      ['checkout', runCheckoutSweep],
      ['expiry', runExpirySweep],
    ];
    for (const [name, stage] of stages) {
      try {
        await stage();
      } catch (err: any) {
        logger.error(`[POS-PAYMENTS-SCHEDULER] ${name} sweep failed`, { message: err?.message });
      }
    }
    return true;
  } finally {
    sweepInFlight = false;
  }
}

export function startPosPaymentsScheduler(): void {
  if (sweepInterval) return;
  logger.info('[POS-PAYMENTS-SCHEDULER] ⏰ Started — running every 45 seconds');
  runPosPaymentsSweep().catch((err) => logger.error('[POS-PAYMENTS-SCHEDULER] Initial run error:', err?.message));
  sweepInterval = setInterval(() => {
    runPosPaymentsSweep().catch((err) => logger.error('[POS-PAYMENTS-SCHEDULER] Job error:', err?.message));
  }, SWEEP_INTERVAL_MS);
}

export function stopPosPaymentsScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    logger.info('[POS-PAYMENTS-SCHEDULER] ⏰ Stopped');
  }
}
