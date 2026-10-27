import type { PoolClient } from "pg";
import { rewardPointsRepository } from "../reward-points/reward-points.repository";
import { referralRepository } from "../referral/referral.repository";

// Undoes everything a bill did to a client's reward points and referral
// balance, so hard-deleting the bill doesn't leave points/credit behind that
// were earned (or spent) on a sale that no longer exists. Runs on the caller's
// delete transaction, BEFORE the payments rows are removed — it needs them to
// find the ledger rows.
//
// What ties a ledger row to a bill:
//  - reward points earn/redeem and referral-balance redeem are written with
//    source_type 'payment' / source_id = payments.id → exact match.
//  - referral_welcome / referral_payout carry the referee's client id as
//    source_id (one per client, ever), not a payment id, so they are matched
//    to the bill by being written within seconds of one of its payments.
//    The welcome row is written just before the payment insert, the payout
//    just after, hence the window either side.
//  - the welcome *discount* (bill >= min amount) writes no ledger row at all;
//    it is recognised by sales.referral_source = 'referral_program'.
// Reversals are 'adjust' ledger rows (the original rows are kept as the audit
// trail). Balances are clamped at 0 by applyLedgerEntry, so points/credit the
// client has already spent can't be clawed back below zero.
const ROW_WINDOW = "30 seconds";

export async function reverseBillLoyalty(
    client: PoolClient,
    ref: { appointmentId: string | null; saleId: string | null }
): Promise<void> {
    let appointmentId = ref.appointmentId;
    if (!appointmentId && ref.saleId) {
        const { rows } = await client.query(`SELECT appointment_id FROM sales WHERE id = $1`, [ref.saleId]);
        appointmentId = rows[0]?.appointment_id ?? null;
    }
    if (!appointmentId) return;

    const { rows: payments } = await client.query(
        `SELECT id, client_id, salon_id FROM payments WHERE appointment_id = $1`,
        [appointmentId]
    );
    if (payments.length === 0) return;
    const paymentIds: string[] = payments.map((p: any) => String(p.id));
    const note = "Reversed — bill deleted";

    // ── Reward points: take back what the bill earned, give back what it spent
    const { rows: pointRows } = await client.query(
        `SELECT client_id, salon_id, points FROM reward_points_ledger
         WHERE source_type = 'payment' AND source_id::text = ANY($1::text[]) AND type IN ('earn', 'redeem')`,
        [paymentIds]
    );
    for (const r of pointRows) {
        const delta = -Number(r.points);
        if (!delta) continue;
        await rewardPointsRepository.applyLedgerEntry({
            clientId: r.client_id, salonId: r.salon_id, type: "adjust", delta,
            sourceType: "bill_deleted", sourceId: appointmentId, note,
        }, client);
    }

    // ── Referral balance spent on the bill → give it back
    const { rows: spendRows } = await client.query(
        `SELECT client_id, salon_id, amount FROM referral_ledger
         WHERE source_type = 'payment' AND source_id::text = ANY($1::text[]) AND type = 'redeem'`,
        [paymentIds]
    );
    for (const r of spendRows) {
        const delta = -Number(r.amount);
        if (!delta) continue;
        await referralRepository.applyLedgerEntry({
            clientId: r.client_id, salonId: r.salon_id, type: "adjust", delta,
            sourceType: "bill_deleted", sourceId: appointmentId, note,
        }, client);
    }

    // ── Referral welcome / payout triggered by this bill
    const { rows: rewardRows } = await client.query(
        `SELECT DISTINCT l.id, l.client_id, l.salon_id, l.amount, l.source_type, l.source_id
         FROM referral_ledger l
         JOIN payments p ON p.appointment_id = $1 AND p.client_id::text = l.source_id::text
         WHERE l.source_type IN ('referral_welcome', 'referral_payout')
           AND l.type = 'earn'
           AND l.created_at BETWEEN p.created_at - $2::interval AND p.created_at + $2::interval`,
        [appointmentId, ROW_WINDOW]
    );
    for (const r of rewardRows) {
        const delta = -Number(r.amount);
        if (delta) {
            await referralRepository.applyLedgerEntry({
                clientId: r.client_id, salonId: r.salon_id, type: "adjust", delta,
                sourceType: "bill_deleted", sourceId: appointmentId, note,
            }, client);
        }
        // Re-arm the one-time reward so the referee's next qualifying bill earns it.
        if (r.source_type === "referral_welcome") {
            await client.query(`UPDATE clients SET referral_referee_rewarded = FALSE WHERE id = $1`, [r.source_id]);
        } else {
            await client.query(
                `UPDATE clients SET referral_reward_status = 'pending'
                 WHERE id = $1 AND referral_reward_status = 'completed'`,
                [r.source_id]
            );
        }
    }

    // Welcome given as an instant discount on this bill (no ledger row).
    const { rows: discounted } = await client.query(
        `SELECT 1 FROM sales
         WHERE (appointment_id = $1 OR ($2::uuid IS NOT NULL AND id = $2))
           AND referral_source = 'referral_program' LIMIT 1`,
        [appointmentId, ref.saleId]
    );
    if (discounted.length > 0) {
        const refereeIds = [...new Set(payments.map((p: any) => p.client_id).filter(Boolean))];
        if (refereeIds.length > 0) {
            await client.query(
                `UPDATE clients SET referral_referee_rewarded = FALSE WHERE id = ANY($1::uuid[])`,
                [refereeIds]
            );
        }
    }
}
