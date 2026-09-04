import { Request } from 'express';
import { PosPaymentStatus } from '../pos-payments.types';

export type ProviderCredentials = Record<string, string>;

export type CreateProviderPaymentParams = {
  reference: string;      // our PAY-XXXXX, sent to the provider as the merchant reference
  amount: number;
  currency: string;
  terminalProviderId?: string | null; // provider-issued device/terminal id, if the provider needs one
  merchantId?: string | null;
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
  getPaymentStatus(reference: string, providerTransactionId?: string | null): Promise<ProviderStatusResult>;
  cancelPayment(reference: string, providerTransactionId?: string | null): Promise<void>;
  /** No documented webhook for a provider (e.g. Paytm EDC today) just returns false. */
  verifyWebhook(req: Request): boolean;
  parseWebhook(req: Request): NormalizedWebhookEvent;
  /** Best-effort auth/reachability check for the Settings "Test Connection" button. */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
