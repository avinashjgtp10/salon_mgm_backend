import axios from 'axios';
// Official Paytm-maintained checksum utility (github.com/paytm/Paytm_Node_Checksum,
// npm: paytmchecksum) — used instead of hand-rolling the SHA256+AES128 signing
// Paytm's own docs describe, since the exact key-derivation steps aren't public.
import PaytmChecksum from 'paytmchecksum';
import logger from '../../../config/logger';
import {
  PaymentProvider,
  CreateProviderPaymentParams,
  ProviderCreateResult,
  ProviderStatusResult,
  NormalizedWebhookEvent,
} from './provider.types';
import { ProviderCredentials } from './provider.types';

export type PaytmCredentials = {
  mid: string;
  merchantKey: string;
};

// Paytm's own docs (paytmpayments.com/docs/pos-connection-via-payment-request,
// .../api/pos-status-enquiry-api) confirm these paths for their EDC "Payment
// Request" (CPay) product. Two things are NOT confirmed from public docs and
// must be verified against Paytm's private integration packet once a real
// EDC merchant account exists (this repo cannot test any of this without one):
//   1. The production host — docs only publicly show the staging host below;
//      the production equivalent is inferred, not confirmed.
//   2. Which of Paytm's two documented status endpoints
//      (edc-integration-service/txn/status vs ecr/V2/payment/status) is
//      canonical for the terminal model actually provisioned.
const HOSTS = {
  sandbox: 'https://securestage.paytmpayments.com',
  production: 'https://securegw.paytmpayments.com', // UNCONFIRMED — verify before go-live
};

function mapPaytmStatus(raw: string | undefined): ProviderStatusResult['status'] {
  switch ((raw || '').toUpperCase()) {
    case 'IN_QUEUE':
    case 'PENDING':
      return 'PROCESSING';
    case 'COMPLETED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'PROCESSING';
  }
}

export class PaytmProvider implements PaymentProvider {
  private readonly baseUrl: string;
  private readonly creds: PaytmCredentials;

  constructor(credentials: ProviderCredentials, environment: 'sandbox' | 'production') {
    if (!credentials.mid || !credentials.merchantKey) {
      throw new Error('Paytm provider requires mid and merchantKey in payment_provider_configs.credentials');
    }
    this.creds = { mid: credentials.mid, merchantKey: credentials.merchantKey };
    this.baseUrl = HOSTS[environment] ?? HOSTS.sandbox;
  }

  private async sign(params: Record<string, unknown>): Promise<string> {
    return PaytmChecksum.generateSignature(params, this.creds.merchantKey);
  }

  async createPayment(params: CreateProviderPaymentParams): Promise<ProviderCreateResult> {
    const body: Record<string, unknown> = {
      mid: this.creds.mid,
      merchantTxnId: params.reference,
      txnAmount: params.amount.toFixed(2),
    };
    // Routes the push to a specific registered terminal — without this, a
    // salon with more than one EDC machine under the same MID has no way to
    // control which physical terminal actually picks the transaction off
    // the queue. `terminalProviderId` is the TID printed on the machine's
    // own info screen (Settings → POS / Payment Machine → terminal's TID),
    // matching Paytm's standard mid+tid identification pair used across
    // their whole POS product line.
    if (params.terminalProviderId) body.tid = params.terminalProviderId;
    body.reqHash = await this.sign(body);

    try {
      const { data } = await axios.post(`${this.baseUrl}/edc-integration-service/payment/request`, body, {
        timeout: 15_000,
      });
      return {
        providerTransactionId: data?.cpayId ?? null,
        status: mapPaytmStatus(data?.status),
        raw: data,
      };
    } catch (err: any) {
      logger.error('[pos-payments/paytm] createPayment failed', { message: err?.message, response: err?.response?.data });
      throw err;
    }
  }

  async getPaymentStatus(reference: string): Promise<ProviderStatusResult> {
    const params: Record<string, unknown> = { mid: this.creds.mid, merchantTransactionId: reference };
    const checksum = await this.sign(params);

    try {
      const { data } = await axios.get(`${this.baseUrl}/edc-integration-service/txn/status`, {
        params: { ...params, checksum },
        timeout: 15_000,
      });
      return {
        status: mapPaytmStatus(data?.status),
        providerTransactionId: data?.cpayId ?? null,
        amount: data?.txnAmount != null ? Number(data.txnAmount) : null,
        raw: data,
      };
    } catch (err: any) {
      logger.error('[pos-payments/paytm] getPaymentStatus failed', { message: err?.message, response: err?.response?.data });
      throw err;
    }
  }

  async cancelPayment(reference: string): Promise<void> {
    // VOID API is documented to exist (paytmpayments.com/docs/pos-wireless-
    // integration-void-cancel-transaction) but its exact request/response
    // schema wasn't retrievable from public docs — best-effort only. Failing
    // here must never block the local request from being marked CANCELLED
    // (see pos-payments.service.ts cancel()), since Paytm's VOID only works
    // same-day anyway and a stale/expired request has nothing left to void.
    const params: Record<string, unknown> = { mid: this.creds.mid, merchantTxnId: reference, txnType: 1 };
    const checksum = await this.sign(params);
    try {
      await axios.post(`${this.baseUrl}/edc-integration-service/payment/cancel`, { ...params, checksum }, {
        timeout: 15_000,
      });
    } catch (err: any) {
      logger.warn('[pos-payments/paytm] cancelPayment (VOID) failed — local record still marked CANCELLED', {
        message: err?.message, response: err?.response?.data,
      });
    }
  }

  verifyWebhook(): boolean {
    // No documented EDC-specific webhook — confirmation for this provider is
    // poll-only (see pos-payments.scheduler.ts). Always false so an unproven
    // inbound call can never move money.
    return false;
  }

  parseWebhook(): NormalizedWebhookEvent {
    throw new Error('Paytm EDC has no documented webhook — this should never be called');
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.getPaymentStatus('CONNECTION_TEST_PROBE');
      return { ok: true, message: 'Reached Paytm and received a structured response.' };
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 401 || httpStatus === 403) {
        return { ok: false, message: 'Paytm rejected the credentials (401/403).' };
      }
      // Any other structured HTTP error (e.g. a "transaction not found" style
      // business error for the probe reference) still proves the mid/checksum
      // were accepted — only a network-level failure counts as not connected.
      if (err?.response) {
        return { ok: true, message: 'Reached Paytm; credentials were accepted.' };
      }
      return { ok: false, message: err?.message || 'Could not reach Paytm.' };
    }
  }
}
