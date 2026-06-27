import { clientMembershipsRepository } from './client-memberships.repository';
import { membershipsRepository } from '../memberships/memberships.repository';
import pool from '../../config/database';
import type {
  CreateClientMembershipDTO,
  ConsumeSessionDTO,
  ClientMembershipsListQuery,
} from './client-memberships.types';
import logger from '../../config/logger';

export const clientMembershipsService = {

  async purchase(salonId: string, dto: CreateClientMembershipDTO) {
    return clientMembershipsRepository.create(salonId, dto);
  },

  async list(salonId: string, query: ClientMembershipsListQuery) {
    return clientMembershipsRepository.list(salonId, query);
  },

  async getById(id: string, salonId: string) {
    return clientMembershipsRepository.findById(id, salonId);
  },

  async consume(id: string, salonId: string, dto: ConsumeSessionDTO) {
    return clientMembershipsRepository.consumeSession(id, salonId, dto);
  },

  async cancel(id: string, salonId: string) {
    return clientMembershipsRepository.cancel(id, salonId);
  },

  // Backfill: scan paid appointments and completed sales to create missing client_membership records
  async syncFromAppointments(salonId: string): Promise<{ created: number; skipped: number; debug?: any }> {
    let created = 0;
    let skipped = 0;
    const debugInfo: any = {};
    try {
      // ── Step 1: diagnostic — how many paid appointments with membership_items exist? ──
      const diagAppts = await pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0`,
        [salonId],
      );
      debugInfo.appts_with_mem_items = parseInt(diagAppts.rows[0]?.cnt ?? '0', 10);

      const diagPaid = await pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      );
      debugInfo.appts_paid_with_mem_items = parseInt(diagPaid.rows[0]?.cnt ?? '0', 10);

      const diagSales = await pool.query(
        `SELECT COUNT(*) AS cnt FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND s.status = 'completed'
           AND si.item_type = 'membership' AND s.client_id IS NOT NULL`,
        [salonId],
      );
      debugInfo.sale_mem_items = parseInt(diagSales.rows[0]?.cnt ?? '0', 10);

      logger.info('[client-memberships/sync] diagnostic:', debugInfo);

      // ── Step 2: process paid appointments with membership_items ──────────────
      const { rows: appts } = await pool.query(
        `SELECT DISTINCT a.id, a.client_id, a.membership_items
         FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      );

      for (const appt of appts) {
        const items: any[] = Array.isArray(appt.membership_items) ? appt.membership_items : [];
        for (const item of items) {
          try {
            // Resolve membership: try by ID first, then by name
            let mem = await pool.query(
              `SELECT id, name, colour, session_type, number_of_sessions
               FROM memberships
               WHERE salon_id = $1
                 AND (id::text = $2 OR (($2 IS NULL OR $2 = '') AND LOWER(name) = LOWER($3)))
               LIMIT 1`,
              [salonId, item.membership_id || null, item.name || ''],
            );
            if (!mem.rows.length && item.name) {
              mem = await pool.query(
                `SELECT id, name, colour, session_type, number_of_sessions
                 FROM memberships WHERE salon_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
                [salonId, item.name],
              );
            }
            if (!mem.rows.length) { skipped++; continue; }
            const m = mem.rows[0];

            const existing = await pool.query(
              `SELECT 1 FROM client_memberships
               WHERE client_id = $1 AND membership_id = $2 AND salon_id = $3 AND status = 'active' LIMIT 1`,
              [appt.client_id, m.id, salonId],
            );
            if (existing.rows.length) { skipped++; continue; }

            // Get client info
            const cRes = await pool.query(
              `SELECT COALESCE(full_name, first_name || ' ' || COALESCE(last_name,'')) AS name,
                      phone_number, email FROM clients WHERE id = $1 LIMIT 1`,
              [appt.client_id],
            );
            const c = cRes.rows[0];
            const totalSessions = m.session_type === 'limited' ? (Number(m.number_of_sessions) || 0) : 0;
            const pricePaid = Number(item.price || 0) * Math.max(1, Number(item.quantity || 1));

            await pool.query(
              `INSERT INTO client_memberships
                 (id, salon_id, client_id, client_name, mobile, email,
                  membership_id, membership_name, colour, total_sessions, used_sessions,
                  expires_at, status, price_paid)
               VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,0,NULL,'active',$10)`,
              [salonId, appt.client_id, c?.name ?? '', c?.phone_number ?? null, c?.email ?? null,
               m.id, m.name, m.colour, totalSessions, pricePaid],
            );
            created++;
          } catch (err: any) {
            logger.warn('[sync] appt item error:', err?.message ?? err);
            skipped++;
          }
        }
      }

      // ── Step 3: process sale_items with membership type ──────────────────────
      const { rows: saleItems } = await pool.query(
        `SELECT si.item_id, si.name, si.unit_price, si.quantity, s.client_id
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND s.status = 'completed'
           AND si.item_type = 'membership' AND s.client_id IS NOT NULL`,
        [salonId],
      );

      for (const row of saleItems) {
        try {
          let mem = await pool.query(
            `SELECT id, name, colour, session_type, number_of_sessions FROM memberships
             WHERE salon_id = $1 AND (id::text = $2 OR ($2 IS NULL AND LOWER(name) = LOWER($3)))
             LIMIT 1`,
            [salonId, row.item_id || null, row.name || ''],
          );
          if (!mem.rows.length && row.name) {
            mem = await pool.query(
              `SELECT id, name, colour, session_type, number_of_sessions FROM memberships
               WHERE salon_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
              [salonId, row.name],
            );
          }
          if (!mem.rows.length) { skipped++; continue; }
          const m = mem.rows[0];

          const existing = await pool.query(
            `SELECT 1 FROM client_memberships
             WHERE client_id = $1 AND membership_id = $2 AND salon_id = $3 AND status = 'active' LIMIT 1`,
            [row.client_id, m.id, salonId],
          );
          if (existing.rows.length) { skipped++; continue; }

          const cRes = await pool.query(
            `SELECT COALESCE(full_name, first_name || ' ' || COALESCE(last_name,'')) AS name,
                    phone_number, email FROM clients WHERE id = $1 LIMIT 1`,
            [row.client_id],
          );
          const c = cRes.rows[0];
          const totalSessions = m.session_type === 'limited' ? (Number(m.number_of_sessions) || 0) : 0;
          const pricePaid = Number(row.unit_price || 0) * Math.max(1, Number(row.quantity || 1));

          await pool.query(
            `INSERT INTO client_memberships
               (id, salon_id, client_id, client_name, mobile, email,
                membership_id, membership_name, colour, total_sessions, used_sessions,
                expires_at, status, price_paid)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,0,NULL,'active',$10)`,
            [salonId, row.client_id, c?.name ?? '', c?.phone_number ?? null, c?.email ?? null,
             m.id, m.name, m.colour, totalSessions, pricePaid],
          );
          created++;
        } catch (err: any) {
          logger.warn('[sync] sale item error:', err?.message ?? err);
          skipped++;
        }
      }

      logger.info(`[client-memberships/sync] done — created=${created} skipped=${skipped}`, debugInfo);
    } catch (err: any) {
      logger.error('[client-memberships/sync] fatal error:', err?.message ?? err);
      debugInfo.fatalError = err?.message ?? String(err);
    }
    return { created, skipped, debug: debugInfo };
  },

  // Diagnostic: show what data exists in the DB for this salon
  async debugInfo(salonId: string) {
    const [apptTotal, apptWithMem, apptPaidWithMem, apptSamples, pmtSamples, saleMem] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS cnt FROM appointments WHERE salon_id = $1`, [salonId]),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments
         WHERE salon_id = $1 AND membership_items IS NOT NULL AND jsonb_array_length(membership_items) > 0`,
        [salonId],
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.membership_items IS NOT NULL AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      ),
      // Sample appointments with membership_items
      pool.query(
        `SELECT a.id, a.client_id, a.membership_items,
                (SELECT p.status FROM payments p WHERE p.appointment_id = a.id LIMIT 1) AS payment_status,
                (SELECT p.appointment_id FROM payments p WHERE p.appointment_id = a.id LIMIT 1) AS linked_payment
         FROM appointments a
         WHERE a.salon_id = $1 AND a.membership_items IS NOT NULL AND jsonb_array_length(a.membership_items) > 0
         LIMIT 5`,
        [salonId],
      ),
      // Sample payments with appointment_id
      pool.query(
        `SELECT id, appointment_id, client_id, status, created_at
         FROM payments WHERE salon_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [salonId],
      ),
      // Sale items with membership type
      pool.query(
        `SELECT COUNT(*) AS cnt FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND si.item_type = 'membership'`,
        [salonId],
      ),
    ]);
    return {
      total_appointments:                parseInt(apptTotal.rows[0]?.cnt ?? '0', 10),
      appointments_with_membership_items: parseInt(apptWithMem.rows[0]?.cnt ?? '0', 10),
      paid_appointments_with_memberships: parseInt(apptPaidWithMem.rows[0]?.cnt ?? '0', 10),
      sale_membership_items:              parseInt(saleMem.rows[0]?.cnt ?? '0', 10),
      sample_appointments_with_memberships: apptSamples.rows,
      recent_payments:                    pmtSamples.rows,
    };
  },

  // Fire-and-forget: called from payments.service when membership is sold
  async autoCreateFromPayment(
    salonId: string,
    clientId: string,
    membershipId: string,
    membershipName: string,
    totalSessions: number,
    pricePaid: number,
    colour?: string,
    expiresAt?: string,
  ): Promise<void> {
    logger.info(`[client-memberships/auto-create] salon=${salonId} client=${clientId} membership=${membershipId} name="${membershipName}" sessions=${totalSessions} price=${pricePaid}`);
    try {
      const existing = await clientMembershipsRepository.findActiveByClientAndMembership(clientId, membershipId, salonId);
      if (existing) {
        logger.info(`[client-memberships/auto-create] already exists (id=${existing.id}), skipping`);
        return;
      }
      await clientMembershipsRepository.create(salonId, {
        clientId,
        membershipId,
        membershipName,
        colour,
        totalSessions,
        pricePaid,
        expiresAt,
      });
      logger.info(`[client-memberships/auto-create] SUCCESS — client=${clientId}, membership=${membershipName}`);
    } catch (err: any) {
      logger.warn('[client-memberships/auto-create] FAILED:', err?.message ?? err);
    }
  },
};
