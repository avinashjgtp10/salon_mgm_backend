// Pure parsers for what Meta publishes on its WhatsApp pricing page. No network, no database: easy to unit-test, and they
// fail closed (throw / return nothing) rather than guess, so a changed page can never store wrong prices.
//
// What the page contains (checked against the live page, effective 1 Oct 2026):
//   * a table of rate-card downloads, one row per currency, as <a> links labelled "INR list rates", "INR volume tiers", ...
//     (signed Meta-CDN links wrapped in l.facebook.com/l.php?u=...; they change on every page load).
//     The files are Excel workbooks even though the links end in .csv.
//   * a list "Pricing regions on the rate card (country calling codes)": "Standalone on rate cards" followed by
//     "India (IN) - 91" ..., then region headings ("North America – 2 markets", "Rest of Africa – 40 markets", ...) with their
//     countries, then "Other – All other markets".
import * as XLSX from 'xlsx'
import type { CardLinks, MarketMapEntry, RateRow, RateSheet, TierRow } from './pricing.types'

// Only links to Meta's own hosts are ever downloaded.
const ALLOWED_HOST = /(^|\.)(facebook\.com|fbcdn\.net|whatsapp\.com|whatsapp\.net)$/i

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** Lower-case, accent- and punctuation-free form of a market / country name, for matching names between the two Meta lists. */
export const normName = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

function unwrapHref(rawHref: string): string | null {
  const href = decodeEntities(rawHref)
  const wrapped = href.match(/^https?:\/\/l\.facebook\.com\/l\.php\?(?:[^#]*&)?u=([^&]+)/i)
  let target = href
  if (wrapped) {
    try { target = decodeURIComponent(wrapped[1]) } catch { return null }
  }
  try {
    const u = new URL(target)
    if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

/** The rate-card download links on Meta's pricing page: `{ AED: { list, tiers }, ... }`. */
export function parseRateCardLinks(html: string): CardLinks {
  const out: CardLinks = {}
  const anchor = /<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchor.exec(html))) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const list = label.match(/^([A-Z]{3}) list rates$/i)
    const tiers = list ? null : label.match(/^([A-Z]{3}) volume tiers$/i)
    const hit = list ?? tiers
    if (!hit) continue
    const url = unwrapHref(m[1])
    if (!url) continue
    const ccy = hit[1].toUpperCase()
    out[ccy] ??= {}
    out[ccy][list ? 'list' : 'tiers'] ??= url
  }
  return out
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "... effective October 1, 2026 ..." -> "2026-10-01" (null if the text carries no date). */
export function parseEffectiveDate(text: string | null | undefined): string | null {
  const m = String(text ?? '').match(/effective\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

/** A price cell: a number, or null for "n/a" / blank / anything else. Prices are never negative. */
const price = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}

const sheetRows = (buffer: Buffer): unknown[][] => {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('The rate card has no sheet')
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
}

const titleOf = (rows: unknown[][]): string | null => {
  const t = String(rows[0]?.[0] ?? '').trim()
  return t || null
}

/**
 * A "List rates" workbook: title row, then a header row starting "Market" and one row per market
 * (Market | Currency | Marketing | Utility | Authentication | Authentication-International | Service | ...).
 */
export function parseRateWorkbook(buffer: Buffer): RateSheet {
  const rows = sheetRows(buffer)
  const header = rows.findIndex((r) => String(r[0] ?? '').trim().toLowerCase() === 'market')
  if (header < 0) throw new Error('Rate card: header row not found')
  const cols = rows[header].map((c) => String(c ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
  const at = (...names: string[]) => cols.findIndex((c) => names.some((n) => c === n))
  const iCcy = at('currency'), iMkt = at('marketing'), iUtil = at('utility'), iAuth = at('authentication')
  const iIntl = cols.findIndex((c) => c.startsWith('authentication-') || c.startsWith('authentication -') || c.startsWith('authentication international'))
  const iSvc = at('service')
  if ([iCcy, iMkt, iUtil, iAuth].some((i) => i < 0)) throw new Error('Rate card: expected columns are missing')

  const out: RateRow[] = []
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]
    const market = String(r[0] ?? '').trim()
    const currency = String(r[iCcy] ?? '').trim().toUpperCase()
    if (!market || !/^[A-Z]{3}$/.test(currency)) continue
    const marketing = price(r[iMkt])
    // A real market row always has a marketing price; anything else is a note under the table.
    if (marketing === null) continue
    out.push({
      market,
      currency,
      marketing,
      utility: price(r[iUtil]),
      authentication: price(r[iAuth]),
      authIntl: iIntl >= 0 ? price(r[iIntl]) : null,
      service: iSvc >= 0 ? price(r[iSvc]) : null,
    })
  }
  if (out.length === 0) throw new Error('Rate card: no market rows found')
  const currencies = new Set(out.map((r) => r.currency))
  if (currencies.size !== 1) throw new Error('Rate card: more than one currency in one file')
  const title = titleOf(rows)
  return { currency: out[0].currency, effectiveDate: parseEffectiveDate(title), effectiveText: title, rows: out }
}

/**
 * A "Volume tiers" workbook. Layout: Market (only on the first row of each market) | Currency, then three blocks of
 * From | To | Rate type | Rate | vs. List rate for Utility, Authentication and Authentication-International.
 */
export function parseTiersWorkbook(buffer: Buffer): TierRow[] {
  const rows = sheetRows(buffer)
  const header = rows.findIndex((r) => String(r[1] ?? '').trim().toLowerCase() === 'currency' && String(r[2] ?? '').trim().toLowerCase() === 'from')
  if (header < 0) throw new Error('Volume tiers: header row not found')
  const blocks: { category: TierRow['category']; at: number }[] = [
    { category: 'utility', at: 2 },
    { category: 'authentication', at: 7 },
    { category: 'authIntl', at: 12 },
  ]
  const out: TierRow[] = []
  let market = ''
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]
    const name = String(r[0] ?? '').trim()
    if (name) market = name
    const currency = String(r[1] ?? '').trim().toUpperCase()
    if (!market || !/^[A-Z]{3}$/.test(currency)) continue
    for (const b of blocks) {
      const from = price(r[b.at])
      const rate = price(r[b.at + 3])
      if (from === null || rate === null) continue   // "n/a" block for this market
      const toRaw = r[b.at + 1]
      const vs = typeof r[b.at + 4] === 'number' ? (r[b.at + 4] as number) : 0
      out.push({
        market, currency, category: b.category, from,
        to: price(toRaw),   // "--" (open-ended last tier) -> null
        rateType: String(r[b.at + 2] ?? '').trim() || 'List rate',
        rate, vsList: vs,
      })
    }
  }
  return out
}

const unescapeJsonText = (s: string) =>
  s.replace(/\\+u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))

/**
 * The country-calling-code table on the pricing page -> one entry per country with the rate-card market it is charged as.
 * Countries listed under "Standalone on rate cards" are their own market; those under a region heading are charged as that region.
 * A country that is not listed anywhere is charged as "Other" (the caller handles that).
 */
export function parseMarketMap(html: string): MarketMapEntry[] {
  const start = html.indexOf('Pricing regions on the rate card')
  if (start < 0) return []
  const text = unescapeJsonText(html.slice(start, start + 200_000))

  // The page embeds its content as JSON strings: children":["India (IN) - 91"]
  const items: string[] = []
  const marker = 'children\\":[\\"'
  let p = 0
  while ((p = text.indexOf(marker, p)) >= 0) {
    const s = p + marker.length
    const e = text.indexOf('\\"', s)
    if (e < 0) break
    items.push(decodeEntities(text.slice(s, e)))
    p = e
  }

  const headingRe = /^(.+?)\s+[–-]\s+(\d+)\s+markets?$/
  const itemRe = /^(.+?) \(([A-Z]{2})\) - (\d+)/
  const out: MarketMapEntry[] = []
  let started = false
  let group: string | null = null
  for (const s of items) {
    if (/^Standalone on rate cards/i.test(s)) { started = true; group = null; continue }
    if (!started) continue
    if (/^Other\s+[–-]\s+All other markets/i.test(s)) break
    const item = s.match(itemRe)
    if (item) { out.push({ country: item[1].trim(), iso2: item[2], dialCode: item[3], market: group ?? item[1].trim() }); continue }
    const heading = s.match(headingRe)
    if (heading) group = heading[1].trim()
  }
  return out
}
