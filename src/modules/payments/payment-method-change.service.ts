import pool from '../../config/database';
import logger from '../../config/logger';
import { AppError } from '../../middleware/error.middleware';
import { paymentMethodsService } from '../payment-methods/payment-methods.service';

// "I picked Cash by mistake, it was UPI" (or "it was half Cash, half UPI") — move all or part of one method of a paid bill to
// another, everywhere the bill records it:
//   * payments.payment_method + payments.split_details  (the money rows; the cash drawer and reports read these)
//   * sales.payment_method   + sales.payment_reference   (the invoice; the split breakdown lives here as JSON)
// The bill's total never changes, only which method the money is filed under. payments.updated_at is deliberately left alone:
// the cash counter assigns a payment to a day by updated_at, so touching it would move the money into another day's drawer.

const BUILT_IN: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI' };
// Legs that are not a money method the customer chose — never renamed, never a target.
const NOT_CHANGEABLE = new Set(['ewallet', 'e-wallet', 'wallet', 'package', 'membership', 'payment machine', 'pos machine', 'pos_machine', 'gift card', 'gift_card', 'giftcard', 'split']);
const EPS = 0.005;

type Legs = Record<string, number>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

const parseLegs = (raw: unknown): Legs | null => {
  if (!raw) return null;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Legs) : null;
  } catch { return null; }
};

/**
 * Moves `amount` of the `from` leg to `to` (all of it when amount is null), adding to a leg already called `to`.
 * Returns the new legs plus how much was moved and whether `from` is now gone; null when `from` isn't there.
 */
function moveAmount(legs: Legs, from: string, to: string, amount: number | null): { legs: Legs; moved: number; fromGone: boolean } | null {
  const fromKey = Object.keys(legs).find((k) => same(k, from));
  if (!fromKey) return null;
  const have = Number(legs[fromKey]) || 0;
  if (have <= 0) return null;
  const moved = round2(amount == null ? have : Math.min(amount, have));
  if (moved <= 0) return null;
  const left = round2(have - moved);
  const fromGone = left <= EPS;
  const next: Legs = {};
  for (const [k, v] of Object.entries(legs)) if (k !== fromKey) next[k] = v;
  if (!fromGone) next[fromKey] = left;
  const toKey = Object.keys(next).find((k) => same(k, to)) ?? to;
  next[toKey] = round2((Number(next[toKey]) || 0) + moved);
  return { legs: next, moved, fromGone };
}

/** "Cash+UPI" / "Package + Cash" style label after the move: drop `from` when it is gone, make sure `to` is named. */
function relabel(label: string, from: string, to: string, fromGone: boolean): string {
  const sep = label.includes(' + ') ? ' + ' : '+';
  const tokens = label.split('+').map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    if (same(t, from) && fromGone) continue;
    if (!out.some((o) => same(o, t))) out.push(t);
  }
  if (!out.some((o) => same(o, to))) out.push(to);
  return out.join(sep);
}

const saleMethodValue = (name: string): string => (BUILT_IN[name.toLowerCase()] ? name.toLowerCase() : name);

export interface ChangePaymentMethodResult {
  from: string;
  to: string;
  moved: number;
  paymentsUpdated: number;
  salesUpdated: number;
}

export const paymentMethodChangeService = {
  async change(params: {
    salonId: string;
    appointmentId: string;
    from: unknown;
    to: unknown;
    /** How much to move. Omit (or send the whole amount) to move everything recorded under `from`. */
    amount?: unknown;
    userId: string;
  }): Promise<ChangePaymentMethodResult> {
    const custom = await paymentMethodsService.nameMap(params.salonId);
    const canon = (raw: unknown): string | null => {
      const key = String(raw ?? '').trim().toLowerCase();
      if (!key || NOT_CHANGEABLE.has(key)) return null;
      return BUILT_IN[key] ?? custom.get(key) ?? null;
    };
    const from = canon(params.from);
    const to = canon(params.to);
    if (!from || !to) throw new AppError(400, 'Choose Cash, Card, UPI or one of your own payment methods.', 'VALIDATION_ERROR');
    if (from === to) throw new AppError(400, 'The new payment method is the same as the old one.', 'VALIDATION_ERROR');
    const touchesCash = from === 'Cash' || to === 'Cash';

    let requested: number | null = null;
    if (params.amount !== undefined && params.amount !== null && params.amount !== '') {
      requested = Number(params.amount);
      if (!Number.isFinite(requested) || requested <= 0) throw new AppError(400, 'Enter an amount greater than zero.', 'VALIDATION_ERROR');
      requested = round2(requested);
    }

    const client = await pool.connect();
    let paymentsUpdated = 0;
    let salesUpdated = 0;
    let movedTotal = 0;
    try {
      await client.query('BEGIN');

      const appt = await client.query(
        `SELECT id, status FROM appointments WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [params.appointmentId, params.salonId]
      );
      if (!appt.rows[0]) throw new AppError(404, 'Bill not found', 'NOT_FOUND');
      if (!['paid', 'partial'].includes(String(appt.rows[0].status))) {
        throw new AppError(400, 'Only a bill that has a payment can change its payment method.', 'VALIDATION_ERROR');
      }

      const pays = await client.query(
        `SELECT * FROM payments WHERE appointment_id = $1 AND salon_id = $2 AND status IN ('partial','completed')
         ORDER BY created_at ASC FOR UPDATE`,
        [params.appointmentId, params.salonId]
      );

      // What each payment row holds per method. A plain single-method row has no split_details: it is all one method.
      const rowLegs = (row: any): Legs | null => {
        const legs = parseLegs(row.split_details);
        if (legs && Object.keys(legs).length > 0) return legs;
        const label = String(row.payment_method ?? '').trim();
        if (label && !label.includes('+')) return { [label]: Number(row.paid_amount ?? row.amount ?? 0) || 0 };
        return null;
      };

      // How much of `from` the bill holds in total — decides whether this is the whole thing or only part of it.
      let fromTotal = 0;
      for (const row of pays.rows) {
        const legs = rowLegs(row);
        const key = legs && Object.keys(legs).find((k) => same(k, from));
        if (legs && key) fromTotal += Number(legs[key]) || 0;
      }
      fromTotal = round2(fromTotal);
      if (fromTotal <= 0) throw new AppError(400, `${from} isn’t one of the payment methods on this bill.`, 'VALIDATION_ERROR');
      if (requested !== null && requested > fromTotal + EPS) {
        throw new AppError(400, `Only ${fromTotal.toFixed(2)} was recorded as ${from}.`, 'VALIDATION_ERROR');
      }
      const partial = requested !== null && requested < fromTotal - EPS;
      let remaining = partial ? (requested as number) : Number.POSITIVE_INFINITY;

      for (const row of pays.rows) {
        if (remaining <= EPS) break;
        const legs = rowLegs(row);
        if (!legs) continue;
        const res = moveAmount(legs, from, to, Number.isFinite(remaining) ? remaining : null);
        if (!res) continue;

        // A card-machine payment was taken on a terminal — its record can't be re-labelled from here.
        if (row.pos_payment_request_id) {
          throw new AppError(409, 'This payment was taken on the card machine, so its method can’t be changed here.', 'POS_PAYMENT');
        }

        // The cash drawer of a closed day is frozen: moving money in or out of Cash there would break its count.
        if (touchesCash) {
          let closed = false;
          await client.query('SAVEPOINT counter_check');
          try {
            const c = await client.query(
              `SELECT 1 FROM cash_management
               WHERE salon_id = $1 AND status = 'closed' AND opened_at <= $2 AND closed_at >= $2 LIMIT 1`,
              [params.salonId, row.updated_at]
            );
            closed = c.rows.length > 0;
          } catch (e: any) {
            // No cash counter table yet = no counters to protect.
            if (e?.code !== '42P01') throw e;
            await client.query('ROLLBACK TO SAVEPOINT counter_check');
          }
          if (closed) {
            throw new AppError(409, 'The cash counter for that day is already closed, so Cash can’t be changed on this bill.', 'CASH_COUNTER_CLOSED');
          }
        }

        const label = String(row.payment_method ?? '');
        const nextLabel = relabel(label, from, to, res.fromGone);
        await client.query(
          `UPDATE payments SET payment_method = $2, split_details = $3::jsonb WHERE id = $1`,
          [row.id, nextLabel, JSON.stringify(res.legs)]
        );
        paymentsUpdated++;
        movedTotal = round2(movedTotal + res.moved);
        if (Number.isFinite(remaining)) remaining = round2(remaining - res.moved);
      }

      // The invoice. A split sale keeps its legs as JSON in payment_reference; a single-method sale only has the method name.
      const sales = await client.query(
        `SELECT id, payment_method, payment_reference FROM sales WHERE appointment_id = $1 AND salon_id = $2 FOR UPDATE`,
        [params.appointmentId, params.salonId]
      );
      for (const sale of sales.rows) {
        const pm = String(sale.payment_method ?? '').trim().toLowerCase();
        let base: Legs | null = null;
        if (pm === 'split') base = parseLegs(sale.payment_reference);
        else if (pm === from.toLowerCase()) base = { [from]: fromTotal };
        if (!base) continue;

        const res = moveAmount(base, from, to, partial ? (requested as number) : null);
        if (!res) continue;
        const keys = Object.keys(res.legs);
        if (keys.length === 1 && !NOT_CHANGEABLE.has(keys[0].toLowerCase())) {
          // Only one real method left and nothing else on the bill -> a plain single-method sale.
          await client.query(`UPDATE sales SET payment_method = $2, payment_reference = NULL WHERE id = $1`, [sale.id, saleMethodValue(keys[0])]);
        } else {
          await client.query(`UPDATE sales SET payment_method = 'split', payment_reference = $2 WHERE id = $1`, [sale.id, JSON.stringify(res.legs)]);
        }
        salesUpdated++;
      }

      if (paymentsUpdated === 0 && salesUpdated === 0) {
        throw new AppError(400, `${from} isn’t one of the payment methods on this bill.`, 'VALIDATION_ERROR');
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Who changed what — after the commit and tolerant of the table not existing yet (Migration/create_payment_method_changes.sql).
    try {
      await pool.query(
        `INSERT INTO payment_method_changes (salon_id, appointment_id, from_method, to_method, changed_by) VALUES ($1,$2,$3,$4,$5)`,
        [params.salonId, params.appointmentId, from, to, params.userId]
      );
    } catch (err: any) {
      if (err?.code !== '42P01') logger.error('[paymentMethodChange] audit insert failed', { message: err?.message });
    }
    logger.info('[paymentMethodChange] changed', { salonId: params.salonId, appointmentId: params.appointmentId, from, to, moved: movedTotal, by: params.userId, paymentsUpdated, salesUpdated });

    return { from, to, moved: movedTotal, paymentsUpdated, salesUpdated };
  },
};
