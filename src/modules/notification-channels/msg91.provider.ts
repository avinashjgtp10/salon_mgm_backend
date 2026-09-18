// ============================================================
// SalonOx — MSG91 transactional SMS provider
// ============================================================
//
// Why this looks different from "send a string to a number":
// Indian transactional SMS is gated by TRAI's DLT registry. A message is only
// delivered if it is addressed by a DLT-approved *template id* under a
// registered sender id, with the variable slots filled in — free text is
// rejected by the carrier, which is exactly how the previous SMSHorizon
// attempt died (TEMPLATE_NOT_MATCHED on every send). So this provider sends
// MSG91's Flow API shape: template_id + per-recipient variables.
//
// The rendered body our own editable template produces is therefore NOT what
// goes out; it is kept for the delivery log and for the preview an owner sees.
// The DLT-registered copy must match it, which is a registration task.
//
// Configuration (all env, see .env.example):
//   MSG91_AUTH_KEY           account auth key
//   MSG91_SENDER_ID          registered 6-char sender/header id
//   MSG91_DLT_TEMPLATE_IDS   {"appointment_confirmation":"64f...", ...}

import config from "../../config/env";
import logger from "../../config/logger";

const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";
const TIMEOUT_MS = 15_000;

// Thrown for conditions that will fail identically on every attempt, so the
// retry classifier in notification-channels.service.ts stops immediately
// instead of burning the full backoff on a configuration problem.
export class Msg91PermanentError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = "Msg91PermanentError";
  }
}

export function isMsg91Configured(): boolean {
  return Boolean(config.msg91.authKey && config.msg91.senderId);
}

export function dltTemplateIdFor(eventType: string): string | null {
  return config.msg91.dltTemplateIds?.[eventType] || null;
}

// MSG91 expects variable names as they appear in the DLT template. Our own
// renderer already produces named variables (client_name, salon_name, …), so
// they are passed through as-is — the DLT template must declare the same
// names. Values are stringified and trimmed; MSG91 rejects nested objects.
function toRecipient(mobile: string, variables: Record<string, string>) {
  const recipient: Record<string, string> = { mobiles: mobile };
  for (const [key, value] of Object.entries(variables ?? {})) {
    if (value === undefined || value === null) continue;
    recipient[key] = String(value);
  }
  return recipient;
}

export async function msg91SendSms(params: {
  to: string;
  eventType: string;
  variables: Record<string, string>;
}): Promise<{ sid: string; status: string }> {
  if (!isMsg91Configured()) {
    throw new Msg91PermanentError("MSG91 is not configured (MSG91_AUTH_KEY / MSG91_SENDER_ID)");
  }

  const templateId = dltTemplateIdFor(params.eventType);
  if (!templateId) {
    throw new Msg91PermanentError(
      `No DLT template id configured for "${params.eventType}" — register the template and add it to MSG91_DLT_TEMPLATE_IDS`
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(MSG91_FLOW_URL, {
      method: "POST",
      headers: {
        authkey: config.msg91.authKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        template_id: templateId,
        sender: config.msg91.senderId,
        short_url: "0",
        recipients: [toRecipient(params.to, params.variables)],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    // Network-level failure — the provider was never reached, so this is
    // transient and the caller's retry loop should have another go. Re-thrown
    // with a Node-style code so the classifier recognises it.
    const wrapped: any = new Error(`MSG91 request failed: ${err?.message ?? err}`);
    wrapped.code = err?.name === "AbortError" ? "ETIMEDOUT" : (err?.code ?? "ECONNRESET");
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (!response.ok) {
    const err: any = new Error(
      `MSG91 responded ${response.status}: ${body?.message ?? text?.slice(0, 200) ?? "no body"}`
    );
    // Surfaced so the retry classifier can distinguish 5xx/429 from a 4xx that
    // will never succeed (bad auth key, unknown template id).
    err.status = response.status;
    throw err;
  }

  // MSG91 returns HTTP 200 with { type: "error" | "success", message }. The
  // request id arrives in `message` on success.
  if (body?.type === "error") {
    throw new Msg91PermanentError(`MSG91 rejected the message: ${body?.message ?? "unknown reason"}`);
  }

  const requestId = typeof body?.message === "string" ? body.message : "";
  logger.info(`[MSG91] queued ${params.eventType} → ${params.to} (request ${requestId || "n/a"})`);
  return { sid: requestId, status: "QUEUED" };
}
