import { Request } from 'express';
import {
  PaymentProvider,
  CreateProviderPaymentParams,
  ProviderCreateResult,
  ProviderStatusResult,
  NormalizedWebhookEvent,
} from './provider.types';

/**
 * Fallback for salons without live API access, and the safety net required
 * even when a real provider is connected: staff has the customer pay on the
 * machine, then types its printed transaction id into a confirm box. There
 * is no external call here at all — confirmation only ever happens via
 * pos-payments.service.ts's confirmManual(), never automatically, so a
 * request can never become SUCCESS just because it was created.
 */
export class ManualProvider implements PaymentProvider {
  async createPayment(params: CreateProviderPaymentParams): Promise<ProviderCreateResult> {
    return { providerTransactionId: null, status: 'PENDING', raw: { reference: params.reference } };
  }

  async getPaymentStatus(): Promise<ProviderStatusResult> {
    // Never polled — manual requests only change status via the staff-entered
    // confirm action (pos-payments.service.ts confirmManual()).
    return { status: 'PENDING', providerTransactionId: null, raw: null };
  }

  async cancelPayment(): Promise<void> {
    // No external system to notify.
  }

  verifyWebhook(_req: Request): boolean {
    return false;
  }

  parseWebhook(): NormalizedWebhookEvent {
    throw new Error('Manual provider has no webhook — this should never be called');
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Manual/fallback mode — no external connection required.' };
  }
}
