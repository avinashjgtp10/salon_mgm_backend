// Meta's published WhatsApp per-message price list (rate cards), as stored and served by this module.
// Meta has no pricing API: the rate cards are files on its public pricing page, read by pricing.sync.service.ts.

/** The message categories Meta prices. "authIntl" is Authentication-International (only some markets have one). */
export type PriceCategory = 'marketing' | 'utility' | 'authentication' | 'authIntl' | 'service'

export interface RateRow {
  /** Meta's market name exactly as on the rate card ("India", "North America", "Rest of Africa", "Other", ...) */
  market: string
  currency: string
  marketing: number | null
  utility: number | null
  authentication: number | null
  authIntl: number | null
  service: number | null
}

export interface RateSheet {
  currency: string
  /** "2026-10-01", from the sheet's own title ("... effective October 1, 2026") */
  effectiveDate: string | null
  effectiveText: string | null
  rows: RateRow[]
}

export interface TierRow {
  market: string
  currency: string
  category: 'utility' | 'authentication' | 'authIntl'
  /** Messages per month this tier starts / ends at (to = null for the open-ended last tier) */
  from: number
  to: number | null
  rateType: string
  rate: number
  /** Discount against the list rate, as a fraction (-0.05 = 5% cheaper) */
  vsList: number
}

export interface CardLinks {
  [currency: string]: { list?: string; tiers?: string }
}

export interface MarketMapEntry {
  country: string
  iso2: string
  /** Leading calling code only ("1" for "1 (809, 829, 849)") */
  dialCode: string
  /** The rate-card market this country is charged as; a country not listed at all is charged as "Other" */
  market: string
}

export interface PricingSyncInfo {
  lastOkAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  effectiveDate: string | null
  effectiveText: string | null
}
