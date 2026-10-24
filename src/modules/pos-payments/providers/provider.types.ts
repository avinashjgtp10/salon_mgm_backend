import { Request } from 'express';
import { PosPaymentStatus } from '../pos-payments.types';

export type ProviderCredentials = Record<string, string>;

export type CreateProviderPaymentParams = {
  reference: string;      // our PAY-XXXXX, sent to the provider as the merchant reference
  amount: number;
  currency: string;
  terminalProviderId?: string | null; // provider-issued device/terminal id, if the provider needs one
  merchantId?: string | null;
  requestedAt: Date;      // pos_payment_requests.created_at — the original txn timestamp
};

/**
 * Everything a follow-up call (status enquiry, cancel/abort) needs to
 * identify the original transaction. Paytm requires the same TID and
 * original txn timestamp that the create call used, so both are carried
 * from the stored request rather than re-derived per call.
 */
export type ProviderTxnContext = {
  reference: string;
  providerTransactionId: string | null;
  terminalProviderId: string | null;  // provider-issued id (Paytm TID), never our payment_terminals.id
  requestedAt: Date;                  // pos_payment_requests.created_at
};

export type ProviderCreateResult = {
  providerTransactionId: string | null;
  status: PosPaymentStatus;
  raw: unknown;
};

export type ProviderStatusResult = {
  status: PosPaymentStatus;
  providerTransactionId: string | null;
  amount?: number | null;
  raw: unknown;
};

/**
 * What the provider said about an abort/cancel request — never the payment's
 * final state. Even ABORT_REQUESTED only means the provider will try; the
 * caller must confirm the outcome with getPaymentStatus().
 */
export type ProviderCancelResult = {
  outcome: 'ABORT_REQUESTED' | 'NOT_ABORTABLE' | 'NOT_FOUND' | 'UNKNOWN';
  retryable?: boolean;
  raw: unknown;
};

export type NormalizedWebhookEvent = {
  reference: string | null;
  providerTransactionId: string | null;
  status: PosPaymentStatus;
  amount?: number | null;
  raw: unknown;
};

/**
 * Billing/checkout code only ever talks to this interface — provider-specific
 * request shapes, auth, and signing live entirely inside each implementation.
 */
export interface PaymentProvider {
  createPayment(params: CreateProviderPaymentParams): Promise<ProviderCreateResult>;
  getPaymentStatus(ctx: ProviderTxnContext): Promise<ProviderStatusResult>;
  cancelPayment(ctx: ProviderTxnContext): Promise<ProviderCancelResult>;
  /** No documented webhook for a provider (e.g. Paytm EDC today) just returns false. */
  verifyWebhook(req: Request): boolean;
  parseWebhook(req: Request): NormalizedWebhookEvent;
  /** Best-effort auth/reachability check for the Settings "Test Connection" button. */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
