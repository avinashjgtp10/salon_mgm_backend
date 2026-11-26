import type { PoolClient } from 'pg'
import pool from '../../../../config/database'
import type { MarketMapEntry, PricingSyncInfo, RateRow, TierRow } from './pricing.types'

// pg returns NUMERIC as a string - every price goes through num() on the way out.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export interface StoredRate extends RateRow { effectiveDate: string | null }
export interface StoredMarket { iso2: string; country: string; dialCode: string; market: string }

let ready = false

export const pricingRepository = {

  /** False until Migration/create_wa_pricing.sql has been run (the routes then say "not set up" instead of failing). */
  async isReady(): Promise<boolean> {
    if (ready) return true
    const { rows } = await pool.query(`SELECT to_regclass('public.wa_pricing_rates') IS NOT NULL AS ok, to_regclass('public.wa_pricing_sync') IS NOT NULL AS ok2`)
    ready = rows[0]?.ok === true && rows[0]?.ok2 === true
    return ready
  },

  async getSyncInfo(): Promise<PricingSyncInfo> {
    const { rows } = await pool.query(
      `SELECT last_ok_at, last_attempt_at, last_error, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, effective_text
       FROM wa_pricing_sync WHERE id = 1`
    )
    const r = rows[0]
    return {
      lastOkAt: r?.last_ok_at ? new Date(r.last_ok_at).toISOString() : null,
      lastAttemptAt: r?.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : null,
      lastError: r?.last_error ?? null,
      effectiveDate: r?.effective_date ?? null,
      effectiveText: r?.effective_text ?? null,
    }
  },

  async recordAttempt(error: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO wa_pricing_sync (id, last_attempt_at, last_error) VALUES (1, NOW(), $1)
       ON CONFLICT (id) DO UPDATE SET last_attempt_at = NOW(), last_error = EXCLUDED.last_error`,
      [error]
    )
  },

  /** Replaces the whole price list in ONE transaction: a failure part-way leaves the previous list exactly as it was. */
  async replaceAll(data: {
    rates: RateRow[]; effectiveDate: string | null; effectiveText: string | null
    markets: MarketMapEntry[]; tiers: TierRow[]
  }): Promise<void> {
    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM wa_pricing_rates')
      await client.query('DELETE FROM wa_pricing_markets')
      await client.query('DELETE FROM wa_pricing_tiers')

      const R = data.rates
      await client.query(
        `INSERT INTO wa_pricing_rates (currency, market, marketing, utility, authentication, auth_international, service, effective_date)
         SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::date[])`,
        [R.map((r) => r.currency), R.map((r) => r.market), R.map((r) => r.marketing), R.map((r) => r.utility),
         R.map((r) => r.authentication), R.map((r) => r.authIntl), R.map((r) => r.service), R.map(() => data.effectiveDate)]
      )

      const M = data.markets
      await client.query(
        `INSERT INTO wa_pricing_markets (iso2, country, dial_code, market)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
        [M.map((m) => m.iso2), M.map((m) => m.country), M.map((m) => m.dialCode), M.map((m) => m.market)]
      )

      const T = data.tiers
      if (T.length) {
        await client.query(
          `INSERT INTO wa_pricing_tiers (currency, market, category, tier_from, tier_to, rate_type, rate, vs_list)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::text[], $7::numeric[], $8::numeric[])
           ON CONFLICT DO NOTHING`,
          [T.map((t) => t.currency), T.map((t) => t.market), T.map((t) => t.category), T.map((t) => t.from), T.map((t) => t.to),
           T.map((t) => t.rateType), T.map((t) => t.rate), T.map((t) => t.vsList)]
        )
      }

      await client.query(
        `INSERT INTO wa_pricing_sync (id, last_ok_at, last_attempt_at, last_error, effective_date, effective_text)
         VALUES (1, NOW(), NOW(), NULL, $1, $2)
         ON CONFLICT (id) DO UPDATE SET last_ok_at = NOW(), last_attempt_at = NOW(), last_error = NULL,
           effective_date = EXCLUDED.effective_date, effective_text = EXCLUDED.effective_text`,
        [data.effectiveDate, data.effectiveText]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  },

  async listCurrencies(): Promise<string[]> {
    const { rows } = await pool.query(`SELECT DISTINCT currency FROM wa_pricing_rates ORDER BY currency`)
    return rows.map((r) => String(r.currency))
  },

  async getMarketForCountry(iso2: string): Promise<StoredMarket | null> {
    const { rows } = await pool.query(
      `SELECT iso2, country, dial_code, market FROM wa_pricing_markets WHERE iso2 = $1`, [iso2]
    )
    const r = rows[0]
    return r ? { iso2: String(r.iso2).trim(), country: r.country, dialCode: r.dial_code, market: r.market } : null
  },

  /** iso2 -> market for every listed country (a country not in this list is charged as "Other"). */
  async getMarketMap(): Promise<Record<string, string>> {
    const { rows } = await pool.query(`SELECT iso2, market FROM wa_pricing_markets`)
    return Object.fromEntries(rows.map((r) => [String(r.iso2).trim(), String(r.market)]))
  },

  async getRates(currency: string, market?: string): Promise<StoredRate[]> {
    const { rows } = await pool.query(
      `SELECT currency, market, marketing, utility, authentication, auth_international, service,
              to_char(effective_date, 'YYYY-MM-DD') AS effective_date
       FROM wa_pricing_rates
       WHERE currency = $1 AND ($2::text IS NULL OR market = $2)
       ORDER BY market`,
      [currency, market ?? null]
    )
    return rows.map((r) => ({
      market: r.market, currency: r.currency,
      marketing: num(r.marketing), utility: num(r.utility), authentication: num(r.authentication),
      authIntl: num(r.auth_international), service: num(r.service), effectiveDate: r.effective_date ?? null,
    }))
  },

  async getTiers(currency: string, market: string): Promise<TierRow[]> {
    const { rows } = await pool.query(
      `SELECT currency, market, category, tier_from, tier_to, rate_type, rate, vs_list
       FROM wa_pricing_tiers WHERE currency = $1 AND market = $2 ORDER BY category, tier_from`,
      [currency, market]
    )
    return rows.map((r) => ({
      currency: r.currency, market: r.market, category: r.category,
      from: Number(r.tier_from), to: r.tier_to === null ? null : Number(r.tier_to),
      rateType: r.rate_type, rate: Number(r.rate), vsList: Number(r.vs_list),
    }))
  },
}
