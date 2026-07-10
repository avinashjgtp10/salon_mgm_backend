/**
 * One-time backfill — bulk-created coupons made BEFORE the batch_id/batch_label
 * columns existed have no batch grouping, so the settings UI lists every code
 * flat instead of collapsing them. A single bulk INSERT statement evaluates
 * NOW() once, so every row from the same batch shares an identical created_at
 * down to the microsecond — that (plus salon_id + matching discount rule) is
 * used here to reconstruct which rows belonged to the same original batch.
 * Run with:  npx ts-node scripts/backfill-coupon-batches.ts
 */
import { randomUUID } from 'crypto';
import pool from '../src/config/database';

function longestCommonPrefix(codes: string[]): string {
  if (codes.length === 0) return '';
  let prefix = codes[0];
  for (const code of codes.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < code.length && prefix[i] === code[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, salon_id, code, created_at, type, value, min_order_amount, max_uses, expires_at, is_active
      FROM coupons
      WHERE batch_id IS NULL
      ORDER BY salon_id, created_at
    `);

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = [r.salon_id, String(r.created_at), r.type, r.value, r.min_order_amount, r.max_uses, r.expires_at, r.is_active].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    let batchCount = 0;
    let rowCount = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue; // singles stay ungrouped
      const batchId = randomUUID();
      const label = longestCommonPrefix(group.map((r) => r.code)) || 'BATCH';
      const ids = group.map((r) => r.id);
      await client.query(`UPDATE coupons SET batch_id = $1, batch_label = $2 WHERE id = ANY($3::uuid[])`, [batchId, label, ids]);
      batchCount++;
      rowCount += group.length;
      console.log(`Grouped ${group.length} coupons under "${label}" (batch_id ${batchId})`);
    }

    console.log(`\n✅ Backfilled ${rowCount} coupons into ${batchCount} batch group(s).`);
  } catch (err: any) {
    console.error('\n❌ Backfill failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
