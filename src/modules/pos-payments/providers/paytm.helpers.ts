// Pure helpers for the Paytm EDC (ECR) integration — kept separate from the
// provider so Sale, Status Enquiry and Abort all derive identical values.

// ASSUMPTION (confirm with Paytm before go-live): ECR timestamps
// (transactionDateTime, requestTimeStamp) are interpreted as Indian Standard
// Time. Paytm's examples are IST wall-clock values with no offset, and every
// SalonOX salon operates in Asia/Kolkata (same zone the rest of this repo
// formats with). If Paytm confirms UTC instead, change only this constant.
export const PAYTM_TIMEZONE = 'Asia/Kolkata';

/** `yyyy-MM-dd HH:mm:ss` in an explicit timezone — never the server's local zone. */
export function formatPaytmDateTime(date: Date, timeZone: string = PAYTM_TIMEZONE): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Paytm timestamp requires a valid Date');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const MERCHANT_TXN_ID = /^[A-Za-z0-9]{8,32}$/;

/**
 * Paytm's merchantTransactionId must be 8–32 alphanumerics. Derived purely
 * from our payment_reference (e.g. "PAY-00042" → "PAY00042") so Status
 * Enquiry and Abort can rebuild the exact same id with no extra storage.
 */
export function toPaytmMerchantTxnId(reference: string): string {
  const id = String(reference ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (!MERCHANT_TXN_ID.test(id)) {
    throw new Error(`Payment reference "${reference}" does not yield a valid Paytm merchantTransactionId (8–32 alphanumerics)`);
  }
  return id;
}

const RUPEES_TEXT = /^\d+(?:\.\d{1,2})?$/;

/**
 * Rupees → whole paise as a string. Accepts the NUMERIC(12,2) text pg
 * returns for pos_payment_requests.amount (no 1700 type parser is
 * registered) as well as a JS number. Rejects non-positive values and
 * anything with more than 2 decimal places rather than rounding it.
 */
export function toPaise(amount: number | string): string {
  let paise: number;
  if (typeof amount === 'string') {
    const text = amount.trim();
    if (!RUPEES_TEXT.test(text)) throw new Error(`Invalid payment amount "${amount}"`);
    const [whole, fraction = ''] = text.split('.');
    paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  } else {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error(`Invalid payment amount "${amount}"`);
    paise = Math.round(amount * 100);
    if (Math.abs(amount * 100 - paise) > 1e-6) {
      throw new Error(`Payment amount ${amount} has more than 2 decimal places`);
    }
  }
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new Error(`Payment amount must be greater than zero (got "${amount}")`);
  }
  return String(paise);
}

/**
 * Paytm's whole-paise amount (string or integer) → rupees, or null when it
 * isn't a positive whole number of paise. Null is never guessed into an
 * amount — callers treat it as "not confirmed".
 */
export function fromPaise(value: unknown): number | null {
  let text = '';
  if (typeof value === 'string') text = value.trim();
  else if (typeof value === 'number' && Number.isSafeInteger(value)) text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const paise = Number(text);
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise / 100;
}
