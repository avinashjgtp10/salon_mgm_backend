import axios from 'axios'
import { AppError } from '../../../../middleware/error.middleware'
import { getSalonCurrency } from '../../../../config/currency'
import { currencyForCountry } from '../../../subscription-pricing/country-currency'
import { configRepository } from '../config/config.repository'
import { pricingRepository, type StoredRate } from './pricing.repository'
import type { TierRow } from './pricing.types'

// Serves the stored copy of Meta's WhatsApp price list (see pricing.sync.service.ts) for the Policy page and the campaign cost estimate.
//
// Meta charges by the RECIPIENT's country calling code ("market"), in the currency of the business's WhatsApp account. Meta
// publishes its prices in 16 currencies; a country whose own currency is not one of them is shown in USD, which Meta publishes
// for every market.

const OTHER_MARKET = 'Other'
const FALLBACK_CURRENCY = 'USD'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v22.0'
const http = axios.create({ timeout: 15_000 })

export type Status = 'ok' | 'not_migrated' | 'no_data'

export interface PriceSet {
  marketing: number | null
  utility: number | null
  authentication: number | null
  authIntl: number | null
  service: number | null
}

const priceSet = (r: StoredRate): PriceSet => ({
  marketing: r.marketing, utility: r.utility, authentication: r.authentication, authIntl: r.authIntl, service: r.service,
})

// The currency the salon's WhatsApp account is billed in - what Meta's invoices (and the Insights page) use. Cached an hour.
const billingCache = new Map<string, { currency: string | null; at: number }>()
async function wabaBillingCurrency(salonId: string): Promise<string | null> {
  const hit = billingCache.get(salonId)
  if (hit && Date.now() - hit.at < (hit.currency ? 60 * 60 * 1000 : 5 * 60 * 1000)) return hit.currency
  let currency: string | null = null
  try {
    const cfg = await configRepository.findBySalonId(salonId)
    if (cfg?.waba_id && cfg.access_token) {
      const r = await http.get(`${WA_BASE_URL}/${WA_API_VERSION}/${cfg.waba_id}`, {
        headers: { Authorization: `Bearer ${cfg.access_token}` }, params: { fields: 'currency' },
      })
      if (r.data?.currency) currency = String(r.data.currency).toUpperCase()
    }
  } catch { /* no connection, or Meta unreachable: the salon's own currency is used instead */ }
  billingCache.set(salonId, { currency, at: Date.now() })
  return currency
}

/** Own currency if Meta publishes it, else USD. `requested` (a currency the caller asked for) wins when published. */
function chooseCurrency(published: string[], country: string | null, requested?: string | null) {
  const want = (requested ?? '').trim().toUpperCase()
  const own = country ? currencyForCountry(country)?.currency ?? null : null
  if (want && published.includes(want)) return { currency: want, ownCurrency: own, fallback: false }
  if (own && published.includes(own)) return { currency: own, ownCurrency: own, fallback: false }
  return { currency: published.includes(FALLBACK_CURRENCY) ? FALLBACK_CURRENCY : published[0], ownCurrency: own, fallback: true }
}

async function ensureData(): Promise<{ status: Status; published: string[] }> {
  if (!(await pricingRepository.isReady())) return { status: 'not_migrated', published: [] }
  const published = await pricingRepository.listCurrencies()
  return { status: published.length ? 'ok' : 'no_data', published }
}

export const pricingService = {

  /** The prices that apply when messaging customers in `country` (ISO-2), for the Policy page. */
  async forCountry(countryRaw: string, requestedCurrency?: string | null) {
    const country = String(countryRaw ?? '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) throw new AppError(400, 'country must be a 2-letter country code', 'VALIDATION_ERROR')

    const { status, published } = await ensureData()
    if (status !== 'ok') return { status }

    const sync = await pricingRepository.getSyncInfo()
    const mapped = await pricingRepository.getMarketForCountry(country)
    const market = mapped?.market ?? OTHER_MARKET
    const { currency, ownCurrency, fallback } = chooseCurrency(published, country, requestedCurrency)

    let rows = await pricingRepository.getRates(currency, market)
    if (!rows.length && market !== OTHER_MARKET) rows = await pricingRepository.getRates(currency, OTHER_MARKET)
    if (!rows.length) return { status: 'no_data' as Status }
    const tiers: TierRow[] = await pricingRepository.getTiers(currency, rows[0].market)

    return {
      status: 'ok' as Status,
      country: { iso2: country, dialCode: mapped?.dialCode ?? null, market: rows[0].market, listed: !!mapped },
      currency, ownCurrency, currencyFallback: fallback,
      rates: priceSet(rows[0]),
      tiers,
      effectiveDate: rows[0].effectiveDate ?? sync.effectiveDate,
      effectiveText: sync.effectiveText,
      lastSyncedAt: sync.lastOkAt,
      lastError: sync.lastError,
      availableCurrencies: published,
    }
  },

  /** Every market's prices in one currency, plus the country -> market table: lets the browser price a whole contact list. */
  async allRates(salonId: string, requestedCurrency?: string | null) {
    const { status, published } = await ensureData()
    if (status !== 'ok') return { status }

    const waba = requestedCurrency ? null : await wabaBillingCurrency(salonId)
    const salonCurrency = await getSalonCurrency(salonId)
    // Billing currency first (what Meta really charges), then the requested one, then the salon's own, then USD.
    const pick = (c: string | null | undefined) => (c && published.includes(c.toUpperCase()) ? c.toUpperCase() : null)
    const chosen = pick(requestedCurrency) ?? pick(waba) ?? pick(salonCurrency) ?? (published.includes(FALLBACK_CURRENCY) ? FALLBACK_CURRENCY : published[0])

    const [rows, countries, sync] = await Promise.all([
      pricingRepository.getRates(chosen), pricingRepository.getMarketMap(), pricingRepository.getSyncInfo(),
    ])
    if (!rows.length) return { status: 'no_data' as Status }
    return {
      status: 'ok' as Status,
      currency: chosen,
      /** The WhatsApp account's own billing currency when Meta told us (null = unknown, e.g. not connected) */
      billingCurrency: waba,
      salonCurrency,
      countries,
      rates: Object.fromEntries(rows.map((r) => [r.market, priceSet(r)])),
      otherMarket: OTHER_MARKET,
      effectiveDate: rows[0].effectiveDate ?? sync.effectiveDate,
      lastSyncedAt: sync.lastOkAt,
    }
  },

  async syncStatus() {
    if (!(await pricingRepository.isReady())) return { status: 'not_migrated' as Status }
    const [info, currencies] = await Promise.all([pricingRepository.getSyncInfo(), pricingRepository.listCurrencies()])
    return { status: (currencies.length ? 'ok' : 'no_data') as Status, currencies: currencies.length, ...info }
  },
}
