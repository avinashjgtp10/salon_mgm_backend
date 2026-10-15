// The salon owner's editable choices for the WhatsApp booking form, and the
// rules that keep whatever they type inside what Meta's Flow JSON accepts
// (labels / titles have hard length caps, time dropdowns max 200 options).

export type BookingFieldKey = 'name' | 'service' | 'other' | 'date' | 'time' | 'notes'

export interface BookingFieldConfig {
  enabled:  boolean
  label:    string
  required: boolean
}

export interface BookingFormConfig {
  title:       string
  buttonLabel: string
  fields:      Record<BookingFieldKey, BookingFieldConfig>
  // Which services the Service dropdown offers. null = every active service
  // (only allowed while there are at most MAX_SERVICES - Meta caps a dropdown).
  serviceIds:  string[] | null
  time:        { start: string; end: string; interval: 15 | 30 | 60 }   // "HH:MM", 24h
}

// Meta limits: input labels 20 chars, screen title 30, footer label 35.
export const LIMITS = { label: 20, title: 30, button: 35 } as const
export const MAX_SERVICES = 200   // Meta's dropdown cap
export const FIELD_KEYS: BookingFieldKey[] = ['name', 'service', 'other', 'date', 'time', 'notes']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Name is always asked (the enquiry needs someone to call) - the owner can
// relabel it but not hide it.
export const ALWAYS_ON: BookingFieldKey[] = ['name']

export const DEFAULT_BOOKING_CONFIG: BookingFormConfig = {
  title:       'Book Appointment',
  buttonLabel: 'Request appointment',
  fields: {
    name:    { enabled: true, label: 'Your name',        required: true  },
    service: { enabled: true, label: 'Service',          required: true  },
    other:   { enabled: false, label: 'Other service',    required: false },
    date:    { enabled: true, label: 'Preferred date',   required: true  },
    time:    { enabled: true, label: 'Preferred time',   required: true  },
    notes:   { enabled: true, label: 'Anything else?',   required: false },
  },
  serviceIds: null,
  time: { start: '10:00', end: '20:00', interval: 30 },
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

// Merges whatever was stored/submitted over the defaults and returns the first
// problem as a message the owner can act on. Unknown keys are dropped.
export function normalizeBookingConfig(input: any): { config: BookingFormConfig; error: string | null } {
  const d = DEFAULT_BOOKING_CONFIG
  const src = input && typeof input === 'object' ? input : {}

  const config: BookingFormConfig = {
    title:       clean(src.title)       || d.title,
    buttonLabel: clean(src.buttonLabel) || d.buttonLabel,
    fields:      {} as BookingFormConfig['fields'],
    serviceIds:  Array.isArray(src.serviceIds)
      ? Array.from(new Set(src.serviceIds.filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x))))
      : null,
    time: {
      start:    HHMM_RE.test(src.time?.start) ? src.time.start : d.time.start,
      end:      HHMM_RE.test(src.time?.end)   ? src.time.end   : d.time.end,
      interval: [15, 30, 60].includes(Number(src.time?.interval)) ? Number(src.time.interval) as 15 | 30 | 60 : d.time.interval,
    },
  }

  for (const key of FIELD_KEYS) {
    const f = src.fields?.[key] ?? {}
    config.fields[key] = {
      enabled:  ALWAYS_ON.includes(key) ? true : f.enabled === undefined ? d.fields[key].enabled : f.enabled === true,
      label:    clean(f.label) || d.fields[key].label,
      required: f.required === undefined ? d.fields[key].required : f.required === true,
    }
  }

  let error: string | null = null
  if (config.title.length > LIMITS.title)         error = `Form title must be ${LIMITS.title} characters or fewer`
  else if (config.buttonLabel.length > LIMITS.button) error = `Button text must be ${LIMITS.button} characters or fewer`
  else {
    for (const key of FIELD_KEYS) {
      if (config.fields[key].label.length > LIMITS.label) {
        error = `"${config.fields[key].label}" is too long - questions can be at most ${LIMITS.label} characters`
        break
      }
    }
  }
  if (!error && config.serviceIds && config.serviceIds.length > MAX_SERVICES) {
    error = `A WhatsApp dropdown holds at most ${MAX_SERVICES} services - you selected ${config.serviceIds.length}`
  }
  if (!error && config.serviceIds && config.serviceIds.length === 0 && config.fields.service.enabled) {
    error = 'Choose at least one service, or turn off the Service question'
  }
  if (!error && toMinutes(config.time.end) <= toMinutes(config.time.start)) {
    error = 'The last appointment time must be later than the first'
  }
  // A time question with no slots would make Meta reject the form.
  if (!error && config.fields.time.enabled && timeOptions(config).length === 0) {
    error = 'No time slots fit between the first and last time'
  }
  return { config, error }
}

export function timeOptions(cfg: BookingFormConfig): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = []
  const { start, end, interval } = cfg.time
  for (let m = toMinutes(start); m <= toMinutes(end); m += interval) {
    const h24 = Math.floor(m / 60), mm = m % 60
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    out.push({
      id:    `${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      title: `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`,
    })
  }
  return out
}
