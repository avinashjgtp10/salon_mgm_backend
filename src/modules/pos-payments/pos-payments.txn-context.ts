import { paymentSettingsRepository } from '../payment-settings/payment-settings.repository';
import { PosPaymentRequest } from './pos-payments.types';
import { ProviderTxnContext } from './providers/provider.types';

// pg returns timestamptz as raw text (see config/database.ts type parsers),
// e.g. "2026-10-22 10:30:00.123456+00" with the session pinned to UTC. Only
// accept values carrying an explicit offset so a provider's txn timestamp is
// never silently reinterpreted in the host's local timezone.
const PG_TIMESTAMPTZ = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** pos_payment_requests.created_at → the original txn timestamp sent to / matched by the provider. */
export function toRequestedAt(createdAt: string | Date): Date {
  if (createdAt instanceof Date) {
    if (Number.isNaN(createdAt.getTime())) throw new Error('pos_payment_requests.created_at is an invalid Date');
    return createdAt;
  }
  const match = PG_TIMESTAMPTZ.exec(String(createdAt ?? '').trim());
  if (!match) {
    throw new Error(`pos_payment_requests.created_at is not a timestamptz with an explicit offset: "${createdAt}"`);
  }
  const [, date, time, fraction = '', offset] = match;
  let isoOffset = offset;
  if (offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    isoOffset = `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2) || '00'}`;
  }
  // ECMAScript only guarantees millisecond precision; pg emits microseconds.
  const parsed = new Date(`${date}T${time}${fraction.slice(0, 4)}${isoOffset}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`pos_payment_requests.created_at could not be parsed: "${createdAt}"`);
  }
  return parsed;
}

/**
 * Builds the follow-up context (status/cancel) for a stored request. The TID
 * comes from payment_terminals.provider_terminal_id — never our own terminal
 * UUID. No is_active check here: a terminal deactivated mid-payment still
 * owns the in-flight transaction and must still be queryable.
 */
export async function buildTxnContext(request: PosPaymentRequest): Promise<ProviderTxnContext> {
  let terminalProviderId: string | null = null;
  if (request.terminal_id) {
    const terminal = await paymentSettingsRepository.findTerminalById(request.terminal_id, request.salon_id);
    terminalProviderId = terminal?.provider_terminal_id ?? null;
  }
  return {
    reference: request.payment_reference,
    providerTransactionId: request.provider_transaction_id,
    terminalProviderId,
    requestedAt: toRequestedAt(request.created_at),
  };
}
