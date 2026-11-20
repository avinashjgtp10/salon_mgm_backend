// Service Chain: automated WhatsApp follow-up journeys (see Migration/create_service_chains.sql).

// Template {{n}} placeholders are mapped to one of these fields per step.
export const CHAIN_VARIABLE_FIELDS = [
  'client_name',
  'salon_name',
  'starting_service',
  'step_service',
  'last_visit_date',
] as const
export type ChainVariableField = (typeof CHAIN_VARIABLE_FIELDS)[number]

// What a repeat purchase of the starting service does while a journey is already running.
export type RepeatPolicy = 'restart' | 'ignore_until_finished'

export interface ChainStepInput {
  service_id:   string | null
  day_offset:   number
  // Skip this step if the client bought its service in the last N days (also counts purchases before they joined). null = off.
  skip_if_bought_days: number | null
  template_id:  string | null
  variable_map: Record<string, ChainVariableField>
  // Extra messages that follow this step (e.g. aftercare), each timed from this step's send time.
  substeps:     SubStepInput[]
}

// A sub-step belongs to a step (or to the starting service itself): it waits delay_minutes after its parent, then sends its own template.
export interface SubStepInput {
  delay_minutes: number
  template_id:   string | null
  variable_map:  Record<string, ChainVariableField>
}

export interface ChainInput {
  name:                string
  description?:        string | null
  starting_service_id: string | null
  send_time:           string          // "HH:MM"
  is_active?:          boolean
  // A half-filled chain saved for later: only the name is required, it never enrols or sends.
  is_draft?:           boolean
  on_repeat?:          RepeatPolicy
  skip_if_bought?:     boolean
  skip_if_completed?:  boolean
  skip_if_upcoming?:   boolean
  // Sub-steps of the starting service: counted from the first payment (aftercare right after the visit).
  start_substeps:      SubStepInput[]
  steps:               ChainStepInput[]
}
