// ============================================================
// SalonOx — POS Payment Confirmation & Expiry Scheduler
// ============================================================
// Paytm EDC (this repo's only wired live provider) has no documented
// webhook — confirmation for it is polling-only. The frontend already polls
// while a staff member is watching the waiting screen, but that stops the
// moment a tab closes; this sweep is what keeps a real in-flight payment
// from getting stranded when nobody's watching. It also expires anything
// abandoned past its window, best-effort cancelling with the provider.

import logger from '../../config/logger';
import { posPaymentsRepository } from './pos-payments.repository';
import { posPaymentsService } from './pos-payments.service';
import { providerFactory } from './providers/provider.factory';

const POLL_SWEEP_MINUTES_OLD = 0.5; // only sweep requests that have had at least ~30s to be created
const SWEEP_INTERVAL_MS = 45 * 1000;

let sweepInterval: NodeJS.Timeout | null = null;

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

async function runExpirySweep(): Promise<void> {
  const expirable = await posPaymentsRepository.listExpirable();
  for (const request of expirable) {
    if (request.provider !== 'manual') {
      try {
        const provider = await providerFactory.getProvider(request.salon_id, request.provider);
        await provider.cancelPayment(request.payment_reference, request.provider_transaction_id);
      } catch (err: any) {
        logger.warn('[POS-PAYMENTS-SCHEDULER] best-effort provider cancel on expiry failed', { requestId: request.id, message: err?.message });
      }
    }
    const updated = await posPaymentsRepository.transitionStatus(request.id, { status: 'EXPIRED' });
    if (updated) {
      await posPaymentsRepository.addEvent(request.id, 'EXPIRED', request.status, 'EXPIRED');
      logger.info(`[POS-PAYMENTS-SCHEDULER] Expired abandoned request ${request.payment_reference}`);
    }
  }
}

async function runSweep(): Promise<void> {
  await runConfirmationSweep();
  await runExpirySweep();
}

export function startPosPaymentsScheduler(): void {
  if (sweepInterval) return;
  logger.info('[POS-PAYMENTS-SCHEDULER] ⏰ Started — running every 45 seconds');
  runSweep().catch((err) => logger.error('[POS-PAYMENTS-SCHEDULER] Initial run error:', err?.message));
  sweepInterval = setInterval(() => {
    runSweep().catch((err) => logger.error('[POS-PAYMENTS-SCHEDULER] Job error:', err?.message));
  }, SWEEP_INTERVAL_MS);
}

export function stopPosPaymentsScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    logger.info('[POS-PAYMENTS-SCHEDULER] ⏰ Stopped');
  }
}
