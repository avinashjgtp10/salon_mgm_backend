import { Request } from 'express';
import { PosPaymentMode, PosPaymentStatus } from '../pos-payments.types';

export type ProviderCredentials = Record<string, string>;

export type CreateProviderPaymentParams = {
  reference: string;      // our PAY-XXXXX, sent to the provider as the merchant reference
  amount: number;
  currency: string;
  terminalProviderId?: string | null; // provider-issued device/terminal id, if the provider needs one
  merchantId?: string | null;
  requestedAt: Date;      // pos_payment_requests.created_at — the original txn timestamp
  // What the machine should accept: CARD (Card) or QR (UPI). Null = the machine's default.
  paymentMode?: PosPaymentMode | null;
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
  // Provider's own explanation of a FAILED result, shown to staff.
  failureReason?: string | null;
  raw: unknown;
};

export type ProviderStatusResult = {
  status: PosPaymentStatus;
  providerTransactionId: string | null;
  amount?: number | null;
  // Provider's own explanation of a FAILED result, shown to staff.
  failureReason?: string | null;
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
  /**
   * Settings "Test connection". `terminalProviderIds` are the salon's active
   * terminals' ids (Paytm TIDs) — Paytm can only be tested against a real TID.
   * ok=true must mean the provider positively accepted the configuration.
   */
  testConnection(options?: { terminalProviderIds?: string[] }): Promise<{ ok: boolean; message: string }>;
}
