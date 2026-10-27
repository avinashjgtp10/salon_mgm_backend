/** Masks a phone number for logs, keeping only the last 4 digits (e.g. ******1234). */
export function maskPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
