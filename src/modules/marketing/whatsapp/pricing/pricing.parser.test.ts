import * as XLSX from 'xlsx'
import {
  normName, parseEffectiveDate, parseMarketMap, parseRateCardLinks, parseRateWorkbook, parseTiersWorkbook,
} from './pricing.parser'

const toBuffer = (aoa: unknown[][], sheet = 'List rates'): Buffer => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// Same shape as Meta's AED "List rates" file (values copied from the 1 Oct 2026 card).
const RATE_AOA: unknown[][] = [
  ['Cost per message in AED on the WhatsApp Business Platform, effective October 1, 2026', '', '', '', '', '', '', ''],
  ['We charge on a per-message basis. Learn more here:', '', '', '', 'https://developers.facebook.com/docs/whatsapp/pricing', '', '', ''],
  ['Market', 'Currency', 'Marketing', 'Utility', 'Authentication', 'Authentication-\nInternational', 'Service', 'Meta Business Agent'],
  ['India', 'AED', 0.0433, 0.0051, 0.0051, 0.1116, 0.0051, '$2.00 USD / 1 M (million) tokens'],
  ['United Arab Emirates', 'AED', 0.2115, 0.0576, 0.0576, 0.1872, 0.0576, '$2.00 USD / 1 M (million) tokens'],
  ['Other', 'AED', 0.2218, 0.0283, 0.0283, 'n/a', 0.0283, '$2.00 USD / 1 M (million) tokens'],
  ['', '', '', '', '', '', '', ''],
  ['A note under the table', '', '', '', '', '', '', ''],
]

describe('parseRateWorkbook', () => {
  it('reads every market with its five prices and the effective date', () => {
    const sheet = parseRateWorkbook(toBuffer(RATE_AOA))
    expect(sheet.currency).toBe('AED')
    expect(sheet.effectiveDate).toBe('2026-10-01')
    expect(sheet.rows.map((r) => r.market)).toEqual(['India', 'United Arab Emirates', 'Other'])
    expect(sheet.rows[1]).toEqual({
      market: 'United Arab Emirates', currency: 'AED',
      marketing: 0.2115, utility: 0.0576, authentication: 0.0576, authIntl: 0.1872, service: 0.0576,
    })
  })

  it('turns "n/a" into null instead of a price', () => {
    const other = parseRateWorkbook(toBuffer(RATE_AOA)).rows.find((r) => r.market === 'Other')!
    expect(other.authIntl).toBeNull()
  })

  it('refuses a file that is not a rate card', () => {
    expect(() => parseRateWorkbook(toBuffer([['nothing', 'useful']]))).toThrow()
  })

  it('refuses a file that mixes currencies', () => {
    const aoa = [...RATE_AOA, ['Egypt', 'USD', 0.1, 0.1, 0.1, 'n/a', 0.1, '']]
    expect(() => parseRateWorkbook(toBuffer(aoa))).toThrow(/more than one currency/)
  })
})

describe('parseTiersWorkbook', () => {
  const AOA: unknown[][] = [
    ['Cost per message in INR ... effective October 1, 2026 - Reflecting volume tiers', ...Array(16).fill('')],
    ['Volume tiers apply only to utility and authentication messages.', ...Array(16).fill('')],
    ['Market\n(per rate card)', '', 'Utility', '', '', '', '', 'Authentication', '', '', '', '', 'Authentication-International', '', '', '', ''],
    ['', '', 'Messages (per month)', '', 'What we charge', '', '', 'Messages (per month)', '', 'What we charge', '', '', 'Messages (per month)', '', 'What we charge', '', ''],
    ['', 'Currency', 'From', 'To', 'Rate type', 'Rate', 'vs. List rate', 'From', 'To', 'Rate type', 'Rate', 'vs. List rate', 'From', 'To', 'Rate type', 'Rate', 'vs. List rate'],
    ['Argentina', 'INR', 0, 100000, 'List rate', 1.9062, 0, 0, 120000, 'List rate', 1.9062, 0, 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'],
    ['', 'INR', 100001, '--', 'Tier rate', 1.8109, -0.05, 120001, '--', 'Tier rate', 1.8109, -0.05, 'n/a', 'n/a', 'n/a', 'n/a', 'n/a'],
    ['Bangladesh', 'INR', 0, 150000, 'List rate', 0.2712, 0, 0, 100000, 'List rate', 0.2712, 0, 0, 100000, 'List rate', 7.036, 0],
  ]

  it('carries the market down, keeps open-ended tiers and skips "n/a" blocks', () => {
    const tiers = parseTiersWorkbook(toBuffer(AOA, 'Volume tiers'))
    const argUtility = tiers.filter((t) => t.market === 'Argentina' && t.category === 'utility')
    expect(argUtility.map((t) => [t.from, t.to, t.rate, t.vsList])).toEqual([[0, 100000, 1.9062, 0], [100001, null, 1.8109, -0.05]])
    expect(tiers.some((t) => t.market === 'Argentina' && t.category === 'authIntl')).toBe(false)
    expect(tiers.find((t) => t.market === 'Bangladesh' && t.category === 'authIntl')?.rate).toBe(7.036)
  })
})

describe('parseRateCardLinks', () => {
  const wrap = (u: string) => `https://l.facebook.com/l.php?u=${encodeURIComponent(u)}&amp;h=AUBabc`
  const html = `
    <a href="${wrap('https://scontent.fpnq7-1.fna.fbcdn.net/v/t39.8562-6/1_n.csv?oh=00_x&oe=6B0B9D4D')}"><span>AED list rates</span></a>
    <a href="${wrap('https://scontent.fpnq7-1.fna.fbcdn.net/v/t39.8562-6/2_n.csv?oh=00_y&oe=6B0B9D4D')}">AED volume tiers</a>
    <a href="${wrap('https://scontent.fpnq7-1.fna.fbcdn.net/v/t39.8562-6/3_n.pdf?oh=00_z')}">AED rates and volume tiers</a>
    <a href="${wrap('https://evil.example.com/x.csv')}">USD list rates</a>
    <a href="https://example.com/">INR list rates</a>
    <a href="${wrap('https://scontent.fpnq7-1.fna.fbcdn.net/v/t39.8562-6/4_n.csv?oh=00_w')}">INR list rates</a>`

  it('maps each currency to its list-rates and tiers file and ignores the PDF', () => {
    const links = parseRateCardLinks(html)
    expect(Object.keys(links).sort()).toEqual(['AED', 'INR'])
    expect(links.AED.list).toContain('/1_n.csv?oh=00_x&oe=6B0B9D4D')
    expect(links.AED.tiers).toContain('/2_n.csv')
    expect(links.INR.list).toContain('/4_n.csv')
  })

  it('never returns a link to a host that is not Meta\'s', () => {
    const links = parseRateCardLinks(html)
    expect(links.USD).toBeUndefined()
    expect(JSON.stringify(links)).not.toContain('example.com')
  })
})

describe('parseMarketMap', () => {
  // The page embeds its text as JSON inside a script: quotes and – are escaped.
  const child = (s: string) => `{\\"type\\":\\"DMCCommonLi\\",\\"props\\":{},\\"children\\":[\\"${s}\\"]}`
  const html = `<script>Pricing regions on the rate card ${[
    child('Standalone on rate cards \\\\u2013 2 markets'),
    child('India (IN) - 91'),
    child('United Arab Emirates (AE) - 971'),
    child('North America \\\\u2013 2 markets'),
    child('Canada (CA) - 1'),
    child('United States (US) - 1'),
    child('Rest of Africa \\\\u2013 40 markets'),
    child('Kenya (KE) - 254'),
    child('Dominican Republic (DO) - 1 (809, 829, 849)'),
    child('Other \\\\u2013 All other markets'),
    child('Prior updates (ZZ) - 999'),
  ].join(',')}</script>`

  it('charges standalone countries as themselves and the others as their region', () => {
    const map = parseMarketMap(html)
    const by = (iso: string) => map.find((m) => m.iso2 === iso)
    expect(by('AE')).toEqual({ country: 'United Arab Emirates', iso2: 'AE', dialCode: '971', market: 'United Arab Emirates' })
    expect(by('IN')?.market).toBe('India')
    expect(by('US')?.market).toBe('North America')
    expect(by('CA')?.market).toBe('North America')
    expect(by('KE')?.market).toBe('Rest of Africa')
    expect(by('DO')?.dialCode).toBe('1')
  })

  it('stops at "Other" so later sections of the page are not mistaken for countries', () => {
    expect(parseMarketMap(html).find((m) => m.iso2 === 'ZZ')).toBeUndefined()
  })

  it('returns nothing when the section is missing', () => {
    expect(parseMarketMap('<html>no table here</html>')).toEqual([])
  })
})

describe('helpers', () => {
  it('parses an effective date', () => {
    expect(parseEffectiveDate('Cost per message ..., effective October 1, 2026 - x')).toBe('2026-10-01')
    expect(parseEffectiveDate('no date')).toBeNull()
  })
  it('matches names across the two Meta lists', () => {
    expect(normName('Rest of Central & Eastern Europe')).toBe(normName('Rest of Central and Eastern Europe'))
    expect(normName('Türkiye')).toBe('turkiye')
  })
})
