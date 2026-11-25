import axios from 'axios'
import type { PoolClient } from 'pg'
import pool from '../../../../config/database'
import logger from '../../../../config/logger'
import { normName, parseMarketMap, parseRateCardLinks, parseRateWorkbook, parseTiersWorkbook } from './pricing.parser'
import { pricingRepository } from './pricing.repository'
import type { MarketMapEntry, RateRow, RateSheet, TierRow } from './pricing.types'

// Reads Meta's official WhatsApp rate cards from its public pricing page and stores them (see Migration/create_wa_pricing.sql).
//
// Meta has no pricing API; the page lists one rate-card workbook per currency, behind signed links that change on every page
// load, so the page is fetched first and the links taken from it. All-or-nothing: the new list replaces the old one only if
// EVERY check passes (all currencies downloaded, 47-ish markets each, every country mapped to a known market). Any failure leaves
// the previous list untouched and is recorded in wa_pricing_sync.last_error. Meta only changes prices on 1 Jan / Apr / Jul / Oct.

const PAGE_URL = process.env.WA_PRICING_PAGE_URL ?? 'https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing'
// Meta serves the page to ordinary browsers; a bare script User-Agent may get a stripped-down page.
const USER_AGENT = process.env.WA_PRICING_USER_AGENT
  ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PAGE_TIMEOUT_MS = 45_000
const FILE_TIMEOUT_MS = 40_000
const CONCURRENCY = 4
const LOCK_ID = 73190523
const MIN_CURRENCIES = 10        // Meta lists 16; fewer means the page changed shape
const MIN_MARKETS = 30           // Meta lists 47 per currency
const MIN_COUNTRIES = 80         // the calling-code table lists 141

// axios, not the global fetch: Meta answers Node's built-in fetch with HTTP 400 whatever headers are sent (checked), and answers an
// axios call that does not ask for HTML with a stripped-down text version of the page that has no download links. So the page is
// always requested with an explicit Accept: text/html.
const http = axios.create({ maxRedirects: 5, maxContentLength: 20 * 1024 * 1024, validateStatus: () => true })

export async function download(url: string, timeoutMs: number, accept = '*/*'): Promise<Buffer> {
  // A connection that times out or is reset, or a 5xx, is retried a couple of times; anything else (4xx, bad file) is not.
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await http.get<ArrayBuffer>(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        responseType: 'arraybuffer',
        timeout: timeoutMs,
      })
      if (res.status >= 200 && res.status < 300) return Buffer.from(res.data)
      lastError = new Error(`HTTP ${res.status}`)
      if (res.status < 500) throw lastError
    } catch (err) {
      lastError = err
      const code = (err as { code?: string })?.code
      const transient = code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EAI_AGAIN' || /^HTTP 5/.test((err as Error)?.message ?? '')
      if (!transient) throw err
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
  throw lastError instanceof Error ? lastError : new Error('download failed')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

/** Every country is charged as a market that really exists on the rate card; a name that cannot be matched fails the sync. */
export function resolveMarkets(map: MarketMapEntry[], sheetMarkets: string[]): MarketMapEntry[] {
  const byNorm = new Map(sheetMarkets.map((m) => [normName(m), m]))
  const unmatched: string[] = []
  const resolved = map.map((e) => {
    const exact = byNorm.get(normName(e.market))
    if (!exact) { unmatched.push(`${e.country} -> ${e.market}`); return e }
    return { ...e, market: exact }
  })
  if (unmatched.length) throw new Error(`Country table names markets that are not on the rate card: ${unmatched.slice(0, 5).join('; ')}`)
  return resolved
}

export interface SyncResult { ok: boolean; skipped?: string; error?: string; currencies?: number; markets?: number; countries?: number; effectiveDate?: string | null }

let running = false

/** Fetches Meta's page + rate cards and stores them. Never throws: the outcome is in the result and in wa_pricing_sync. */
export async function runPricingSync(): Promise<SyncResult> {
  if (running) return { ok: false, skipped: 'already_running' }
  running = true
  let lock: PoolClient | undefined
  let locked = false
  try {
    if (!(await pricingRepository.isReady())) return { ok: false, skipped: 'not_migrated' }

    // One server at a time (several instances may share the database).
    lock = await pool.connect()
    const got = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])
    locked = got.rows[0]?.locked === true
    if (!locked) return { ok: false, skipped: 'another_instance_is_syncing' }

    try {
      const html = (await download(PAGE_URL, PAGE_TIMEOUT_MS, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toString('utf8')
      const links = parseRateCardLinks(html)
      const currencies = Object.keys(links).filter((c) => links[c].list)
      if (currencies.length < MIN_CURRENCIES || !currencies.includes('USD')) {
        throw new Error(`Meta's pricing page lists ${currencies.length} rate cards (expected ~16, including USD) - the page may have changed`)
      }

      const sheets: RateSheet[] = await mapLimit(currencies, CONCURRENCY, async (c) => {
        try {
          const sheet = parseRateWorkbook(await download(links[c].list as string, FILE_TIMEOUT_MS))
          if (sheet.currency !== c) throw new Error(`file is in ${sheet.currency}, not ${c}`)
          if (sheet.rows.length < MIN_MARKETS) throw new Error(`only ${sheet.rows.length} markets`)
          if (!sheet.rows.some((r) => r.market === 'Other')) throw new Error('no "Other" market')
          return sheet
        } catch (err: any) {
          throw new Error(`${c} rate card: ${err?.message ?? err}`)
        }
      })

      const usd = sheets.find((s) => s.currency === 'USD') as RateSheet
      const countries = resolveMarkets(parseMarketMap(html), usd.rows.map((r) => r.market))
      if (countries.length < MIN_COUNTRIES) throw new Error(`Meta's country table lists only ${countries.length} countries - the page may have changed`)
      // Every currency must price the same set of markets, or an estimate could silently fall through to "Other".
      const marketSet = new Set(usd.rows.map((r) => r.market))
      for (const s of sheets) {
        const missing = [...marketSet].filter((m) => !s.rows.some((r) => r.market === m))
        if (missing.length) throw new Error(`${s.currency} rate card is missing markets: ${missing.slice(0, 3).join(', ')}`)
      }

      // Volume tiers are informational: a tiers file that cannot be read is skipped, never fatal.
      const tierLists = await mapLimit(currencies.filter((c) => links[c].tiers), CONCURRENCY, async (c): Promise<TierRow[]> => {
        try { return parseTiersWorkbook(await download(links[c].tiers as string, FILE_TIMEOUT_MS)) }
        catch (err: any) { logger.warn('[wa-pricing] volume tiers skipped', { currency: c, error: err?.message }); return [] }
      })

      const rates: RateRow[] = sheets.flatMap((s) => s.rows)
      const dates = Array.from(new Set(sheets.map((s) => s.effectiveDate).filter(Boolean) as string[])).sort()
      if (dates.length > 1) logger.warn('[wa-pricing] rate cards carry different effective dates', { dates })
      const effectiveDate = dates[dates.length - 1] ?? null
      const effectiveText = sheets.find((s) => s.effectiveDate === effectiveDate)?.effectiveText ?? null

      await pricingRepository.replaceAll({ rates, effectiveDate, effectiveText, markets: countries, tiers: tierLists.flat() })
      logger.info('[wa-pricing] price list updated', { currencies: currencies.length, countries: countries.length, effectiveDate })
      return { ok: true, currencies: currencies.length, markets: marketSet.size, countries: countries.length, effectiveDate }
    } catch (err: any) {
      const error = String(err?.message ?? err).slice(0, 500)
      logger.warn('[wa-pricing] update failed - keeping the previous price list', { error })
      await pricingRepository.recordAttempt(error).catch(() => undefined)
      return { ok: false, error }
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 500) }
  } finally {
    if (lock) {
      if (locked) await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined)
      lock.release()
    }
    running = false
  }
}

const STALE_AFTER_MS = 20 * 60 * 60 * 1000

/** The scheduler's entry: refresh only when there is no list yet or it is more than ~a day old. */
export async function syncPricingIfDue(): Promise<SyncResult> {
  if (!(await pricingRepository.isReady())) return { ok: false, skipped: 'not_migrated' }
  const info = await pricingRepository.getSyncInfo()
  const fresh = info.lastOkAt && Date.now() - new Date(info.lastOkAt).getTime() < STALE_AFTER_MS
  if (fresh) return { ok: true, skipped: 'fresh' }
  return runPricingSync()
}
