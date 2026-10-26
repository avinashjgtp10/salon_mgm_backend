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
  ProviderTxnContext,
  ProviderCancelResult,
  NormalizedWebhookEvent,
} from './provider.types';
import { ProviderCredentials } from './provider.types';
import { formatPaytmDateTime, fromPaise, toPaise, toPaytmMerchantTxnId } from './paytm.helpers';
import { PosPaymentMode } from '../pos-payments.types';

export type PaytmCredentials = {
  mid: string;
  merchantKey: string;
};

// Paytm EDC ECR API (Sale, Status Enquiry, Abort). URLs exactly as provided
// by Paytm for this integration. The hosts are not uniform — confirm with
// Paytm that this is intended:
//   - Status/Abort staging use securegw-stage.paytm.in, Sale staging uses
//     securegw-stage.paytmpayments.in;
//   - Abort production uses securegw-edc.paytm.com, Sale/Status production
//     use securegw-edc.paytmpayments.in.
const ECR_ENDPOINTS = {
  sale: {
    sandbox: 'https://securegw-stage.paytmpayments.in/ecr/payment/request',
    production: 'https://securegw-edc.paytmpayments.in/ecr/payment/request',
  },
  status: {
    sandbox: 'https://securegw-stage.paytm.in/ecr/V2/payment/status',
    production: 'https://securegw-edc.paytmpayments.in/ecr/V2/payment/status',
  },
  abort: {
    sandbox: 'https://securegw-stage.paytm.in/ecr/abort/txn',
    production: 'https://securegw-edc.paytm.com/ecr/abort/txn',
  },
};
const ECR_CHANNEL_ID = 'EDC';
const ECR_VERSION = '3.1';
// ACCEPTED_SUCCESS: Paytm queued the sale on the terminal. The customer has
// not paid yet — this must never be read as payment success.
const ECR_ACCEPTED_CODE = '0009';
const ECR_TIMEOUT_MS = 15_000;

// Status Enquiry result codes (resultInfo.resultCodeId).
const ECR_STATUS_SUCCESS_CODE = '0000';
const ECR_STATUS_FAILED_CODE = '0011';
// Paytm instructed us to treat these as still in progress and retry the
// enquiry, not as a final outcome.
const ECR_STATUS_RETRYABLE_CODES = new Set(['0010', '0030', '0404']);

// Abort result codes (resultInfo.resultCodeId).
const ECR_ABORT_REQUESTED_CODE = '1845';   // resultCode "R" — requested, outcome still unverified
const ECR_ABORT_NOT_ABORTABLE_CODE = '1843';
const ECR_ABORT_NOT_FOUND_CODE = '1844';
const ECR_ABORT_SERVER_ERROR_CODE = '0012'; // safe to retry the abort later

// Axios error codes meaning the request never left this machine, so Paytm
// cannot have queued it. Anything else without a response (timeout, reset)
// leaves the outcome unknown.
const NOT_SENT_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL']);

// Status Enquiry answers for "Test connection" (Paytm Status Enquiry API docs):
//   0330 = Invalid checksum → the Merchant Key is wrong;
//   0404 = merchantTransactionId doesn't exist → the request was signed
//          correctly and processed for this MID/TID, our probe id just isn't a
//          real sale — the expected answer for a working setup.
const ECR_INVALID_CHECKSUM_CODE = '0330';
const ECR_TXN_NOT_FOUND_CODE = '0404';
// Paytm documents result statuses both as letters and as words.
const ECR_FAILED_STATUSES = new Set(['F', 'FAIL', 'FAILED']);

/** Deep copy with every checksum field removed — for logs and stored responses. */
function stripChecksums(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripChecksums);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/checksum/i.test(key))
        .map(([key, v]) => [key, stripChecksums(v)]),
    );
  }
  return value;
}

/** Paytm's resultMsg (with its code) for staff, e.g. "Invalid TID (code 0001)". */
function paytmResultMessage(info: any): string | null {
  const message = typeof info?.resultMsg === 'string' ? info.resultMsg.trim() : '';
  const code = String(info?.resultCodeId ?? info?.resultCode ?? '').trim();
  if (!message) return code ? `Paytm result code ${code}` : null;
  return code ? `${message} (code ${code})` : message;
}

/**
 * Sale responses only ever acknowledge the request — confirmation comes
 * from Status Enquiry — so this returns PROCESSING or FAILED, never SUCCESS.
 * A response that is neither a clear accept nor a clear failure is treated
 * as an unknown outcome (PROCESSING) rather than a failure, because the
 * terminal may still be prompting the customer.
 */
function interpretSaleResponse(data: any, merchantTransactionId: string): ProviderCreateResult {
  const info = data?.body?.resultInfo ?? {};
  const accepted = String(info.resultCodeId ?? '') === ECR_ACCEPTED_CODE || String(info.resultCode ?? '') === ECR_ACCEPTED_CODE;
  const failed = ECR_FAILED_STATUSES.has(String(info.resultStatus ?? '').toUpperCase());
  const response = stripChecksums(data);

  if (accepted && !failed) {
    return { providerTransactionId: null, status: 'PROCESSING', raw: { merchantTransactionId, response } };
  }
  if (failed && !accepted) {
    logger.warn('[pos-payments/paytm] sale rejected', {
      merchantTransactionId, resultCode: info.resultCode, resultCodeId: info.resultCodeId, resultMsg: info.resultMsg,
    });
    return { providerTransactionId: null, status: 'FAILED', failureReason: paytmResultMessage(info), raw: { merchantTransactionId, response } };
  }
  logger.warn('[pos-payments/paytm] unrecognised sale response — outcome unknown, left PROCESSING', { merchantTransactionId, response });
  return { providerTransactionId: null, status: 'PROCESSING', raw: { merchantTransactionId, outcomeUnknown: true, response } };
}

/**
 * Status Enquiry → SalonOX status. SUCCESS only when every signal agrees
 * (code 0000, resultStatus S, matching merchantTransactionId, valid amount);
 * FAILED only for code 0011 with resultStatus F. Anything else — including
 * contradictions and unknown codes — stays PROCESSING so the next poll can
 * resolve it; an uncertain outcome is never finalised either way.
 */
function interpretStatusResponse(data: any, merchantTransactionId: string): ProviderStatusResult {
  const body = data?.body;
  const info = body?.resultInfo;
  const code = String(info?.resultCodeId ?? info?.resultCode ?? '');
  const resultStatus = String(info?.resultStatus ?? '').toUpperCase();
  const acquirementId = typeof body?.acquirementId === 'string' && body.acquirementId.trim() ? body.acquirementId.trim() : null;
  const amount = fromPaise(body?.transactionAmount);
  const raw = { merchantTransactionId, response: stripChecksums(data) };

  const unknown = (reason: string): ProviderStatusResult => {
    logger.warn('[pos-payments/paytm] status outcome unknown — left PROCESSING', {
      merchantTransactionId, reason, resultCodeId: info?.resultCodeId, resultStatus: info?.resultStatus, resultMsg: info?.resultMsg,
    });
    return { status: 'PROCESSING', providerTransactionId: acquirementId, amount, raw: { ...raw, outcomeUnknown: true, reason } };
  };

  if (!info || typeof info !== 'object') return unknown('response has no resultInfo');
  if (body?.merchantTransactionId != null && String(body.merchantTransactionId) !== merchantTransactionId) {
    return unknown('response merchantTransactionId does not match the request');
  }

  if (code === ECR_STATUS_SUCCESS_CODE) {
    if (resultStatus !== 'S' && resultStatus !== 'SUCCESS') return unknown(`code ${code} without resultStatus S`);
    if (amount == null) return unknown('success without a valid transactionAmount');
    return { status: 'SUCCESS', providerTransactionId: acquirementId, amount, raw };
  }
  if (code === ECR_ACCEPTED_CODE) {
    return { status: 'PROCESSING', providerTransactionId: acquirementId, amount, raw };
  }
  if (ECR_STATUS_RETRYABLE_CODES.has(code)) {
    return { status: 'PROCESSING', providerTransactionId: acquirementId, amount, raw: { ...raw, retryable: true } };
  }
  if (code === ECR_STATUS_FAILED_CODE) {
    if (!ECR_FAILED_STATUSES.has(resultStatus)) return unknown(`code ${code} without resultStatus F`);
    return { status: 'FAILED', providerTransactionId: acquirementId, amount, failureReason: paytmResultMessage(info), raw };
  }
  return unknown(`unrecognised result code "${code}"`);
}

/**
 * Abort response → what Paytm said about the abort request. Deliberately
 * says nothing about the payment itself: even 1845 only means Paytm will
 * try, so the caller always confirms with a Status Enquiry afterwards.
 */
function interpretAbortResponse(data: any, merchantTransactionId: string): ProviderCancelResult {
  const body = data?.body;
  const info = body?.resultInfo;
  const code = String(info?.resultCodeId ?? '');
  const resultCode = String(info?.resultCode ?? '').toUpperCase();
  const raw = { merchantTransactionId, response: stripChecksums(data) };
  const logContext = { merchantTransactionId, resultCodeId: info?.resultCodeId, resultCode: info?.resultCode, resultMsg: info?.resultMsg };

  if (body?.merchantTransactionId != null && String(body.merchantTransactionId) !== merchantTransactionId) {
    logger.warn('[pos-payments/paytm] abort response for a different merchantTransactionId — treated as unknown', logContext);
    return { outcome: 'UNKNOWN', raw: { ...raw, reason: 'merchantTransactionId mismatch' } };
  }
  if (code === ECR_ABORT_NOT_ABORTABLE_CODE) return { outcome: 'NOT_ABORTABLE', raw };
  if (code === ECR_ABORT_NOT_FOUND_CODE) return { outcome: 'NOT_FOUND', raw };
  if (code === ECR_ABORT_SERVER_ERROR_CODE) {
    logger.warn('[pos-payments/paytm] abort hit a Paytm internal error (0012) — retryable', logContext);
    return { outcome: 'UNKNOWN', retryable: true, raw };
  }
  if (code === ECR_ABORT_REQUESTED_CODE || (!code && resultCode === 'R')) return { outcome: 'ABORT_REQUESTED', raw };

  logger.warn('[pos-payments/paytm] unrecognised abort response', logContext);
  return { outcome: 'UNKNOWN', raw: { ...raw, reason: 'unrecognised response' } };
}

/**
 * Sale body extension asking the machine for one payment mode. Paytm's Sale
 * API lists merchantExtendedInfo.paymentMode = ALL / CARD / QR; its sample
 * request sends merchantExtendedInfo as a JSON object, so that shape is used.
 * UNVERIFIED on a live terminal — confirm Card mode and QR mode each open the
 * right screen before go-live.
 */
export function buildMerchantExtendedInfo(paymentMode: PosPaymentMode | null | undefined): { paymentMode: PosPaymentMode } | undefined {
  return paymentMode ? { paymentMode } : undefined;
}

/**
 * Status Enquiry for a probe id that was never sold → what it says about the
 * setup. Only Paytm's documented "transaction doesn't exist" (0404) proves
 * the request was signed with the right Merchant Key and processed for this
 * MID/TID; every other answer is reported as not confirmed, never as OK.
 */
export function interpretConnectionProbe(data: any, tid: string): { ok: boolean; message: string } {
  const info = data?.body?.resultInfo;
  const code = String(info?.resultCodeId ?? info?.resultCode ?? '').trim();
  if (code === ECR_TXN_NOT_FOUND_CODE) {
    return { ok: true, message: `TID ${tid}: Paytm accepted the MID, Merchant Key and TID.` };
  }
  if (code === ECR_INVALID_CHECKSUM_CODE) {
    return { ok: false, message: `TID ${tid}: Paytm rejected the Merchant Key (invalid checksum). Re-enter the key Paytm issued.` };
  }
  const said = paytmResultMessage(info);
  return {
    ok: false,
    message: `TID ${tid}: could not confirm the setup — Paytm answered ${said ? `"${said}"` : 'without a result code'}. Check the MID and TID.`,
  };
}

export class PaytmProvider implements PaymentProvider {
  private readonly environment: 'sandbox' | 'production';
  private readonly ecrUrls: { sale: string; status: string; abort: string };
  private readonly creds: PaytmCredentials;

  constructor(credentials: ProviderCredentials, environment: 'sandbox' | 'production') {
    const mid = String(credentials.mid ?? '').trim();
    const merchantKey = String(credentials.merchantKey ?? '');
    if (!mid || !merchantKey) {
      throw new Error('Paytm provider requires mid and merchantKey in payment_provider_configs.credentials');
    }
    // Messages below never echo the values themselves.
    if (!/^[A-Za-z0-9]+$/.test(mid)) {
      throw new Error('Paytm mid must contain only letters and digits');
    }
    // paytmchecksum encrypts with AES-128-CBC, which needs a 16-byte key —
    // checked here so a bad key fails clearly instead of as a crypto error.
    if (Buffer.byteLength(merchantKey, 'utf8') !== 16) {
      throw new Error('Paytm merchantKey must be exactly 16 characters');
    }
    this.creds = { mid, merchantKey };
    this.environment = environment === 'production' ? 'production' : 'sandbox';
    const ecrEnv = this.environment;
    this.ecrUrls = { sale: ECR_ENDPOINTS.sale[ecrEnv], status: ECR_ENDPOINTS.status[ecrEnv], abort: ECR_ENDPOINTS.abort[ecrEnv] };
  }

  /**
   * ECR request envelope shared by every ECR API: the checksum is generated
   * over the serialized body only, and that exact string is embedded in the
   * payload so the bytes Paytm verifies are the bytes that were signed.
   */
  private async signedEcrPayload(body: Record<string, unknown>): Promise<string> {
    const bodyJson = JSON.stringify(body);
    const checksum = await PaytmChecksum.generateSignature(bodyJson, this.creds.merchantKey);
    const head = {
      requestTimeStamp: formatPaytmDateTime(new Date()),
      channelId: ECR_CHANNEL_ID,
      checksum,
      version: ECR_VERSION,
    };
    return `{"head":${JSON.stringify(head)},"body":${bodyJson}}`;
  }

  private postEcr(url: string, payload: string) {
    return axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: ECR_TIMEOUT_MS,
    });
  }

  // Paytm's Sale, Status Enquiry and Abort APIs all identify the transaction
  // by mid + TID, so a missing TID is a configuration error — fail loudly
  // here rather than send a request Paytm would route to no terminal.
  private requireTid(terminalProviderId: string | null | undefined, operation: string): string {
    const tid = terminalProviderId?.trim();
    if (!tid) {
      throw new Error(
        `Paytm ${operation} requires the terminal's Paytm TID — select a terminal and set its TID under Settings → POS / Payment Machine`,
      );
    }
    return tid;
  }

  /**
   * ECR Sale — pushes the amount to one physical terminal. Everything is
   * validated before anything is sent, so a throw here means Paytm never
   * saw the request. The result is PROCESSING (accepted or outcome unknown)
   * or FAILED (explicit rejection), never SUCCESS.
   */
  async createPayment(params: CreateProviderPaymentParams): Promise<ProviderCreateResult> {
    // The TID routes the sale to one registered terminal: a salon with more
    // than one EDC machine under the same MID has no other way to choose
    // which device picks it up. It's the TID printed on the machine's own
    // info screen (Settings → POS / Payment Machine → terminal's TID).
    const paytmTid = this.requireTid(params.terminalProviderId, 'payment request');
    if (params.currency && params.currency.toUpperCase() !== 'INR') {
      throw new Error(`Paytm EDC only supports INR (got ${params.currency})`);
    }
    const merchantTransactionId = toPaytmMerchantTxnId(params.reference);
    const merchantExtendedInfo = buildMerchantExtendedInfo(params.paymentMode);
    const body = {
      paytmMid: this.creds.mid,
      paytmTid,
      transactionDateTime: formatPaytmDateTime(params.requestedAt),
      merchantTransactionId,
      merchantReferenceNo: merchantTransactionId,
      transactionAmount: toPaise(params.amount),
      // Card → CARD (tap/insert/swipe), UPI → QR (customer scans).
      ...(merchantExtendedInfo ? { merchantExtendedInfo } : {}),
    };
    const payload = await this.signedEcrPayload(body);

    try {
      const { data } = await this.postEcr(this.ecrUrls.sale, payload);
      return interpretSaleResponse(data, merchantTransactionId);
    } catch (err: any) {
      return this.handleSaleTransportError(err, merchantTransactionId);
    }
  }

  // Never logs err.config — it carries the signed payload and checksum.
  private handleSaleTransportError(err: any, merchantTransactionId: string): ProviderCreateResult {
    const response = err?.response;
    const logContext = {
      merchantTransactionId,
      httpStatus: response?.status,
      code: err?.code,
      message: err?.message,
      response: stripChecksums(response?.data),
    };

    if (response) {
      // An explicit Paytm failure body is a definite rejection, whatever the
      // HTTP status. A 5xx without one may have been processed upstream.
      if (String(response.data?.body?.resultInfo?.resultStatus ?? '').toUpperCase() === 'F') {
        return interpretSaleResponse(response.data, merchantTransactionId);
      }
      // 5xx, or 408 (timed out upstream): may have been processed — unknown.
      if (response.status >= 500 || response.status === 408) {
        logger.warn('[pos-payments/paytm] sale got a server error — outcome unknown, left PROCESSING', logContext);
        return { providerTransactionId: null, status: 'PROCESSING', raw: { merchantTransactionId, outcomeUnknown: true, httpStatus: response.status } };
      }
      logger.error('[pos-payments/paytm] sale rejected by Paytm', logContext);
      throw new Error(`Paytm rejected the sale request (HTTP ${response.status})`);
    }

    if (NOT_SENT_ERROR_CODES.has(err?.code)) {
      logger.error('[pos-payments/paytm] sale could not be sent', logContext);
      throw new Error(`Could not reach Paytm (${err.code}) — the sale was not sent`);
    }

    // Timeout / connection reset after sending: Paytm may have queued the
    // sale and the customer may be paying right now. Not a failure.
    logger.warn('[pos-payments/paytm] sale outcome unknown (no response) — left PROCESSING', logContext);
    return { providerTransactionId: null, status: 'PROCESSING', raw: { merchantTransactionId, outcomeUnknown: true, code: err?.code ?? null } };
  }

  /**
   * ECR Status Enquiry. Identifies the sale with exactly the values the Sale
   * request sent — same helpers, same stored reference and created_at — so
   * merchantTransactionId and transactionDateTime always match.
   *
   * Transport failures throw rather than return a status: the caller
   * (getStatus poll-through / scheduler sweep) logs and leaves the request
   * untouched, and the next poll retries.
   */
  async getPaymentStatus(ctx: ProviderTxnContext): Promise<ProviderStatusResult> {
    const paytmTid = this.requireTid(ctx.terminalProviderId, 'status enquiry');
    const merchantTransactionId = toPaytmMerchantTxnId(ctx.reference);
    const payload = await this.signedEcrPayload({
      paytmMid: this.creds.mid,
      paytmTid,
      transactionDateTime: formatPaytmDateTime(ctx.requestedAt),
      merchantTransactionId,
    });

    let data: unknown;
    try {
      ({ data } = await this.postEcr(this.ecrUrls.status, payload));
    } catch (err: any) {
      // Never logs err.config — it carries the signed payload and checksum.
      logger.warn('[pos-payments/paytm] status enquiry failed — outcome unknown, no status change', {
        merchantTransactionId,
        httpStatus: err?.response?.status,
        code: err?.code,
        message: err?.message,
        response: stripChecksums(err?.response?.data),
      });
      const detail = err?.response?.status ? `HTTP ${err.response.status}` : (err?.code ?? 'network error');
      throw new Error(`Paytm status enquiry failed (${detail}) — outcome unknown, will retry`);
    }
    return interpretStatusResponse(data, merchantTransactionId);
  }

  /**
   * ECR Abort — asks Paytm to stop an in-flight sale, identified by exactly
   * the MID, TID, merchantTransactionId and transactionDateTime the Sale
   * sent. Returns what Paytm said about the *abort*; it never decides the
   * payment's state (see pos-payments.service.ts cancel(), which confirms
   * with a Status Enquiry). Transport failures come back as a retryable
   * UNKNOWN rather than a throw; only a missing TID (nothing sent) throws.
   */
  async cancelPayment(ctx: ProviderTxnContext): Promise<ProviderCancelResult> {
    const paytmTid = this.requireTid(ctx.terminalProviderId, 'abort');
    const merchantTransactionId = toPaytmMerchantTxnId(ctx.reference);
    const payload = await this.signedEcrPayload({
      paytmMid: this.creds.mid,
      paytmTid,
      merchantTransactionId,
      transactionDateTime: formatPaytmDateTime(ctx.requestedAt),
    });

    try {
      const { data } = await this.postEcr(this.ecrUrls.abort, payload);
      return interpretAbortResponse(data, merchantTransactionId);
    } catch (err: any) {
      // A structured Paytm body on an HTTP error (e.g. 0012) is still a
      // documented answer; anything else leaves the abort's fate unknown.
      if (err?.response?.data?.body?.resultInfo) {
        return interpretAbortResponse(err.response.data, merchantTransactionId);
      }
      // Never logs err.config — it carries the signed payload and checksum.
      logger.warn('[pos-payments/paytm] abort request failed — outcome unknown', {
        merchantTransactionId,
        httpStatus: err?.response?.status,
        code: err?.code,
        message: err?.message,
        response: stripChecksums(err?.response?.data),
      });
      const detail = err?.response?.status ? `HTTP ${err.response.status}` : (err?.code ?? 'network error');
      return { outcome: 'UNKNOWN', retryable: true, raw: { merchantTransactionId, error: detail } };
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

  /**
   * One ECR Status Enquiry per TID (up to 5) for a probe id that was never
   * sold, on the same server real payments use. Passes only if Paytm answers
   * every TID with its documented "transaction doesn't exist" — see
   * interpretConnectionProbe. Never sends a Sale, so nothing is ever charged
   * and the machine itself isn't contacted: a pass doesn't prove the machine
   * is online, and the message says so.
   */
  async testConnection(options: { terminalProviderIds?: string[] } = {}): Promise<{ ok: boolean; message: string }> {
    const mode = this.environment === 'production' ? 'Live' : 'Test (sandbox)';
    const tids = [...new Set((options.terminalProviderIds ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 5);
    if (tids.length === 0) {
      return { ok: false, message: 'Add an active terminal with its TID first — Paytm can only be tested against a real TID.' };
    }

    const results: { ok: boolean; message: string }[] = [];
    for (const tid of tids) {
      const requestedAt = new Date();
      const merchantTransactionId = `SXTEST${requestedAt.getTime()}`;
      const payload = await this.signedEcrPayload({
        paytmMid: this.creds.mid,
        paytmTid: tid,
        transactionDateTime: formatPaytmDateTime(requestedAt),
        merchantTransactionId,
      });
      try {
        const { data } = await this.postEcr(this.ecrUrls.status, payload);
        results.push(interpretConnectionProbe(data, tid));
      } catch (err: any) {
        if (err?.response?.data?.body?.resultInfo) {
          results.push(interpretConnectionProbe(err.response.data, tid));
        } else {
          const detail = err?.response?.status ? `HTTP ${err.response.status}` : (err?.code ?? err?.message ?? 'network error');
          results.push({ ok: false, message: `TID ${tid}: could not reach Paytm (${detail}).` });
        }
      }
    }

    const ok = results.every((r) => r.ok);
    const summary = results.map((r) => r.message).join(' ');
    return {
      ok,
      message: ok
        ? `${mode}: ${summary} This doesn't check that the machine is switched on — do a ₹1 test payment to confirm.`
        : `${mode}: ${summary}`,
    };
  }
}
