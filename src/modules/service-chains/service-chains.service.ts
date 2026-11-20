import pool from '../../config/database'
import { AppError } from '../../middleware/error.middleware'
import {
  CHAIN_VARIABLE_FIELDS,
  type ChainInput,
  type ChainStepInput,
  type SubStepInput,
  type ChainVariableField,
} from './service-chains.types'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bad = (message: string) => new AppError(400, message, 'VALIDATION_ERROR')

// ── Validation ────────────────────────────────────────────────────────────────
// Everything a save can get wrong is checked here, against THIS salon's own rows,
// so a chain can never point at another salon's service or template.
async function validate(salonId: string, input: ChainInput): Promise<ChainInput> {
  input.steps = input.steps ?? []
  const name = String(input?.name ?? '').trim()
  if (!name) throw bad('Name is required')
  if (name.length > 120) throw bad('Name is too long')
  if (!UUID.test(String(input?.starting_service_id ?? ''))) throw bad('Choose a starting service')
  if (!HHMM.test(String(input?.send_time ?? ''))) throw bad('Send time must be HH:MM')
  if (!Array.isArray(input.steps)) throw bad('Steps are invalid')
  if (input.steps.length > 20) throw bad('A chain can have at most 20 steps')

  const cleanMap = (where: string, raw: Record<string, ChainVariableField> | undefined, allowStepService: boolean) => {
    const map: Record<string, ChainVariableField> = {}
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (!/^\d{1,2}$/.test(k)) throw bad(`${where}: invalid variable ${k}`)
      if (!(CHAIN_VARIABLE_FIELDS as readonly string[]).includes(v as string)) throw bad(`${where}: invalid field for {{${k}}}`)
      // The starting service has no "step service" to put in a blank.
      if (v === 'step_service' && !allowStepService) throw bad(`${where}: "step service" is not available here, use "starting service"`)
      map[k] = v as ChainVariableField
    }
    return map
  }

  const cleanSubs = (where: string, raw: SubStepInput[] | undefined, allowStepService: boolean): SubStepInput[] => {
    if (raw !== undefined && !Array.isArray(raw)) throw bad(`${where}: sub-steps are invalid`)
    const list = raw ?? []
    if (list.length > 10) throw bad(`${where}: at most 10 sub-steps`)
    return list.map((x, k) => {
      const w = `${where}, sub-step ${k + 1}`
      const delay = Number(x?.delay_minutes)
      if (!Number.isInteger(delay) || delay < 10 || delay > 43200) throw bad(`${w}: the wait must be 10 minutes to 30 days`)
      if (!UUID.test(String(x?.template_id ?? ''))) throw bad(`${w}: choose a WhatsApp template`)
      return { delay_minutes: delay, template_id: x.template_id, variable_map: cleanMap(w, x.variable_map, allowStepService) }
    })
  }

  const steps: ChainStepInput[] = input.steps.map((s, i) => {
    const where = `Step ${i + 1}`
    const day = Number(s.day_offset)
    if (!Number.isInteger(day) || day < 0 || day > 365) throw bad(`${where}: days must be 0 to 365`)
    if (!UUID.test(String(s.service_id ?? ''))) throw bad(`${where}: choose a service`)
    if (!UUID.test(String(s.template_id ?? ''))) throw bad(`${where}: choose a WhatsApp template`)
    const skipDays = s.skip_if_bought_days === null || s.skip_if_bought_days === undefined || String(s.skip_if_bought_days) === '' ? null : Number(s.skip_if_bought_days)
    if (skipDays !== null && (!Number.isInteger(skipDays) || skipDays < 1 || skipDays > 730)) throw bad(`${where}: "skip if bought" must be 1 to 730 days`)
    return {
      service_id: s.service_id, day_offset: day, skip_if_bought_days: skipDays, template_id: s.template_id,
      variable_map: cleanMap(where, s.variable_map, true),
      substeps: cleanSubs(where, s.substeps, true),
    }
  })
  const startSubs = cleanSubs('Starting service', input.start_substeps, false)
  // A chain may be just After-purchase messages, or just follow-up steps, but never empty.
  if (steps.length === 0 && startSubs.length === 0) throw bad('Add at least one message or follow-up step')

  const serviceIds = [...new Set([input.starting_service_id, ...steps.map((s) => s.service_id as string)])]
  const { rows: svc } = await pool.query(
    `SELECT id::text FROM services WHERE salon_id = $1 AND id = ANY($2::uuid[])`,
    [salonId, serviceIds],
  )
  if (svc.length !== serviceIds.length) throw bad('One of the chosen services was not found')

  // Every message (step or sub-step) in one list so templates are checked once.
  const messages: Array<{ where: string; template_id: string; variable_map: Record<string, ChainVariableField> }> = [
    ...startSubs.map((x, k) => ({ where: `Starting service, sub-step ${k + 1}`, template_id: x.template_id as string, variable_map: x.variable_map })),
    ...steps.flatMap((s, i) => [
      { where: `Step ${i + 1}`, template_id: s.template_id as string, variable_map: s.variable_map },
      ...s.substeps.map((x, k) => ({ where: `Step ${i + 1}, sub-step ${k + 1}`, template_id: x.template_id as string, variable_map: x.variable_map })),
    ]),
  ]
  if (messages.length > 60) throw bad('A chain can have at most 60 messages in total')

  const templateIds = [...new Set(messages.map((m) => m.template_id))]
  const { rows: tpl } = await pool.query(
    `SELECT id::text, name, body_text, status FROM wa_templates WHERE salon_id = $1 AND id = ANY($2::uuid[])`,
    [salonId, templateIds],
  )
  if (tpl.length !== templateIds.length) throw bad('One of the chosen templates was not found')
  const notApproved = tpl.find((t) => t.status !== 'APPROVED')
  if (notApproved) throw bad(`Template "${notApproved.name}" is not approved by Meta yet. Only approved templates can be used.`)

  // Every {{n}} in a template body needs a field, or the client would get "Value2".
  const bodyById = new Map(tpl.map((t) => [t.id, String(t.body_text ?? '')]))
  for (const m of messages) {
    const slots = new Set((bodyById.get(m.template_id)!.match(/\{\{(\d+)\}\}/g) ?? []).map((x) => x.replace(/\D/g, '')))
    for (const slot of slots) {
      if (!m.variable_map[slot]) throw bad(`${m.where}: choose a value for {{${slot}}}`)
    }
  }

  return {
    name,
    description: input.description ? String(input.description).trim() || null : null,
    starting_service_id: input.starting_service_id,
    send_time: input.send_time,
    is_active: input.is_active !== false,
    is_draft: false,
    ...ruleFields(input),
    start_substeps: startSubs,
    steps,
  }
}

// The chain-level rules, defaulting to the safe choices when a client omits them.
function ruleFields(input: ChainInput) {
  return {
    on_repeat: input.on_repeat === 'ignore_until_finished' ? ('ignore_until_finished' as const) : ('restart' as const),
    skip_if_bought: input.skip_if_bought !== false,
    skip_if_completed: input.skip_if_completed !== false,
    skip_if_upcoming: input.skip_if_upcoming !== false,
  }
}

// A draft keeps whatever was filled in: only the name is required and anything unusable is dropped rather than rejected, so
// an owner can save half a chain (for example while Meta approves a template) and finish it later. It never enrols or sends;
// activating it goes through validate() above. Ids must still belong to this salon.
async function sanitizeDraft(salonId: string, input: ChainInput): Promise<ChainInput> {
  const name = String(input?.name ?? '').trim()
  if (!name) throw bad('Name is required')
  if (name.length > 120) throw bad('Name is too long')
  const uuid = (v: unknown) => (UUID.test(String(v ?? '')) ? String(v) : null)
  const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Math.trunc(Number(v))
    return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback
  }
  const cleanMap = (raw: Record<string, ChainVariableField> | undefined) => {
    const map: Record<string, ChainVariableField> = {}
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (/^\d{1,2}$/.test(k) && (CHAIN_VARIABLE_FIELDS as readonly string[]).includes(v as string)) map[k] = v as ChainVariableField
    }
    return map
  }
  const subs = (raw: SubStepInput[] | undefined): SubStepInput[] =>
    (Array.isArray(raw) ? raw : []).slice(0, 10).map((x) => ({
      delay_minutes: clampInt(x?.delay_minutes, 10, 43200, 60), template_id: uuid(x?.template_id), variable_map: cleanMap(x?.variable_map) }))
  const steps: ChainStepInput[] = (Array.isArray(input.steps) ? input.steps : []).slice(0, 20).map((s) => ({
    service_id: uuid(s?.service_id),
    day_offset: clampInt(s?.day_offset, 0, 365, 0),
    skip_if_bought_days: s?.skip_if_bought_days ? clampInt(s.skip_if_bought_days, 1, 730, 30) : null,
    template_id: uuid(s?.template_id),
    variable_map: cleanMap(s?.variable_map),
    substeps: subs(s?.substeps),
  }))
  const startSubs = subs(input.start_substeps)
  let startingServiceId = uuid(input.starting_service_id)

  // Only ids that belong to this salon survive.
  const serviceIds = [...new Set([startingServiceId, ...steps.map((s) => s.service_id)].filter((x): x is string => !!x))]
  if (serviceIds.length) {
    const { rows } = await pool.query(`SELECT id::text FROM services WHERE salon_id = $1 AND id = ANY($2::uuid[])`, [salonId, serviceIds])
    const ok = new Set(rows.map((r) => r.id))
    if (startingServiceId && !ok.has(startingServiceId)) startingServiceId = null
    steps.forEach((s) => { if (s.service_id && !ok.has(s.service_id)) s.service_id = null })
  }
  const templateIds = [...new Set([...startSubs, ...steps, ...steps.flatMap((s) => s.substeps)].map((x) => x.template_id).filter((x): x is string => !!x))]
  if (templateIds.length) {
    const { rows } = await pool.query(`SELECT id::text FROM wa_templates WHERE salon_id = $1 AND id = ANY($2::uuid[])`, [salonId, templateIds])
    const ok = new Set(rows.map((r) => r.id))
    for (const x of [...startSubs, ...steps, ...steps.flatMap((s) => s.substeps)]) if (x.template_id && !ok.has(x.template_id)) x.template_id = null
  }

  return {
    name,
    description: input.description ? String(input.description).trim() || null : null,
    starting_service_id: startingServiceId,
    send_time: HHMM.test(String(input.send_time ?? '')) ? input.send_time : '10:00',
    is_active: false,
    is_draft: true,
    ...ruleFields(input),
    start_substeps: startSubs,
    steps,
  }
}

const CHAIN_LIST_SQL = `
  SELECT ch.id, ch.name, ch.description, ch.starting_service_id, ch.send_time, ch.is_active, ch.is_draft, ch.on_repeat, ch.skip_if_bought, ch.skip_if_completed, ch.skip_if_upcoming,
         ch.created_at, ch.updated_at, sv.name AS starting_service_name,
         (SELECT COUNT(*)::int FROM service_chain_steps s WHERE s.chain_id = ch.id AND NOT s.is_sub) AS step_count,
         (SELECT COUNT(*)::int FROM service_chain_enrolments e WHERE e.chain_id = ch.id AND e.status = 'active') AS active_enrolments,
         (SELECT COUNT(*)::int FROM service_chain_enrolments e WHERE e.chain_id = ch.id AND e.status <> 'superseded') AS total_enrolments,
         (SELECT COUNT(*)::int FROM service_chain_messages m JOIN service_chain_enrolments e ON e.id = m.enrolment_id
            WHERE e.chain_id = ch.id AND m.status IN ('SENT','DELIVERED','READ')) AS sent_count,
         (SELECT COUNT(*)::int FROM service_chain_messages m JOIN service_chain_enrolments e ON e.id = m.enrolment_id
            WHERE e.chain_id = ch.id AND m.status = 'FAILED') AS failed_count
  FROM service_chains ch
  LEFT JOIN services sv ON sv.id = ch.starting_service_id
  WHERE ch.salon_id = $1 AND ch.deleted_at IS NULL`

async function loadSteps(chainId: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.step_order, s.service_id, s.day_offset, s.delay_minutes, s.skip_if_bought_days, s.parent_step_id, s.is_sub, s.template_id, s.variable_map,
            sv.name AS service_name, t.name AS template_name, t.status AS template_status
     FROM service_chain_steps s
     LEFT JOIN services sv ON sv.id = s.service_id
     LEFT JOIN wa_templates t ON t.id = s.template_id
     WHERE s.chain_id = $1 ORDER BY s.step_order`,
    [chainId],
  )
  return rows
}

// Rows are stored flat, in send order: the starting service's sub-steps, then each step followed by its own sub-steps
// (step_order is unique per chain). parent_step_id ties a sub-step to its step; the starting service's sub-steps have none.
type FlatRow = {
  is_sub: boolean; parentIdx: number | null; service_id: string | null; day_offset: number; delay_minutes: number | null; skip_days: number | null
  template_id: string | null; variable_map: Record<string, ChainVariableField>
}
function flatten(input: ChainInput): FlatRow[] {
  const out: FlatRow[] = input.start_substeps.map((x) => ({
    is_sub: true, parentIdx: null, service_id: null, day_offset: 0, delay_minutes: x.delay_minutes, skip_days: null, template_id: x.template_id, variable_map: x.variable_map }))
  for (const s of input.steps) {
    const at = out.length
    out.push({ is_sub: false, parentIdx: null, service_id: s.service_id, day_offset: s.day_offset, delay_minutes: null, skip_days: s.skip_if_bought_days, template_id: s.template_id, variable_map: s.variable_map })
    for (const x of s.substeps) {
      out.push({ is_sub: true, parentIdx: at, service_id: null, day_offset: 0, delay_minutes: x.delay_minutes, skip_days: null, template_id: x.template_id, variable_map: x.variable_map })
    }
  }
  return out
}

async function writeSteps(client: { query: typeof pool.query }, chainId: string, input: ChainInput) {
  const rows = flatten(input)
  // Update in place (not delete + insert) so messages already scheduled against a step keep their link.
  const { rows: existing } = await client.query(
    `SELECT id FROM service_chain_steps WHERE chain_id = $1 ORDER BY step_order`, [chainId])
  // Park old orders out of the way first: (chain_id, step_order) is unique.
  await client.query(`UPDATE service_chain_steps SET step_order = step_order + 1000 WHERE chain_id = $1`, [chainId])
  const ids: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const reuse = existing[i]?.id
    const args = [i + 1, r.service_id, r.day_offset, r.delay_minutes, r.is_sub, r.template_id, JSON.stringify(r.variable_map), r.skip_days]
    if (reuse) {
      await client.query(
        `UPDATE service_chain_steps SET step_order = $2, service_id = $3, day_offset = $4, delay_minutes = $5, is_sub = $6, parent_step_id = NULL,
                template_id = $7, variable_map = $8::jsonb, skip_if_bought_days = $9 WHERE id = $1`,
        [reuse, ...args])
      ids.push(reuse)
    } else {
      const { rows: ins } = await client.query(
        `INSERT INTO service_chain_steps (chain_id, step_order, service_id, day_offset, delay_minutes, is_sub, template_id, variable_map, skip_if_bought_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
        [chainId, ...args])
      ids.push(ins[0].id)
    }
  }
  // Second pass: now every row has its id, point each sub-step at its step.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].parentIdx !== null) {
      await client.query(`UPDATE service_chain_steps SET parent_step_id = $2 WHERE id = $1`, [ids[i], ids[rows[i].parentIdx as number]])
    }
  }
  // Rows the owner removed: their unsent messages go with them (FK cascade).
  await client.query(
    `DELETE FROM service_chain_steps WHERE chain_id = $1 AND step_order > 1000 AND NOT (id = ANY($2::uuid[]))`,
    [chainId, ids])
}

export const serviceChainsService = {

  async list(salonId: string) {
    const { rows } = await pool.query(`${CHAIN_LIST_SQL} ORDER BY ch.created_at DESC`, [salonId])
    return rows
  },

  async getById(id: string, salonId: string) {
    const { rows } = await pool.query(`${CHAIN_LIST_SQL} AND ch.id = $2`, [salonId, id])
    if (!rows[0]) throw new AppError(404, 'Service chain not found', 'NOT_FOUND')
    return { ...rows[0], steps: await loadSteps(id) }
  },

  async create(salonId: string, raw: ChainInput) {
    const input = raw.is_draft === true ? await sanitizeDraft(salonId, raw) : await validate(salonId, raw)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO service_chains (salon_id, name, description, starting_service_id, send_time, is_active, is_draft, on_repeat, skip_if_bought, skip_if_completed, skip_if_upcoming)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [salonId, input.name, input.description, input.starting_service_id, input.send_time, input.is_active, input.is_draft, input.on_repeat, input.skip_if_bought, input.skip_if_completed, input.skip_if_upcoming])
      await writeSteps(client, rows[0].id, input)
      await client.query('COMMIT')
      return this.getById(rows[0].id, salonId)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  },

  // Edits affect FUTURE enrolments: messages already scheduled keep their dates, but read the step's
  // template and variable map when they send. A new starting service applies to new purchases only.
  async update(id: string, salonId: string, raw: ChainInput) {
    const existing = await this.getById(id, salonId)
    // Only a draft can be saved as a draft: an active or paused chain must always stay complete.
    if (raw.is_draft === true && !existing.is_draft) throw bad('Only a draft can be saved as a draft')
    const input = raw.is_draft === true ? await sanitizeDraft(salonId, raw) : await validate(salonId, raw)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE service_chains SET name=$3, description=$4, starting_service_id=$5, send_time=$6, is_active=$7, is_draft=$8,
                on_repeat=$9, skip_if_bought=$10, skip_if_completed=$11, skip_if_upcoming=$12, updated_at=NOW()
         WHERE id=$1 AND salon_id=$2`,
        [id, salonId, input.name, input.description, input.starting_service_id, input.send_time, input.is_active, input.is_draft, input.on_repeat, input.skip_if_bought, input.skip_if_completed, input.skip_if_upcoming])
      await writeSteps(client, id, input)
      await client.query('COMMIT')
      return this.getById(id, salonId)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  },

  // Pause / resume. A paused chain enrols nobody new, and a message that comes due while it is paused is
  // cancelled by the runner, so reactivating before that date resumes the journey.
  async setActive(id: string, salonId: string, active: boolean) {
    const current = await this.getById(id, salonId)
    if (current.is_draft) throw bad('Finish the draft and use Activate Chain first')
    const { rowCount } = await pool.query(
      `UPDATE service_chains SET is_active = $3, updated_at = NOW() WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL`,
      [id, salonId, active])
    if (!rowCount) throw new AppError(404, 'Service chain not found', 'NOT_FOUND')
    return this.getById(id, salonId)
  },

  async remove(id: string, salonId: string) {
    await this.getById(id, salonId)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE service_chain_messages m SET status = 'CANCELLED', skip_reason = 'Chain deleted', updated_at = NOW()
         FROM service_chain_enrolments e
         WHERE m.enrolment_id = e.id AND e.chain_id = $1 AND m.status IN ('SCHEDULED', 'POSTPONED')`, [id])
      await client.query(
        `UPDATE service_chain_enrolments SET status = 'cancelled', updated_at = NOW() WHERE chain_id = $1 AND status IN ('active','paused')`, [id])
      await client.query(
        `UPDATE service_chains SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1 AND salon_id = $2`, [id, salonId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  },

  // Per-client log: each enrolment with every step's status and reason.
  async listEnrolments(chainId: string, salonId: string, opts: { status?: string; page?: number; limit?: number }) {
    await this.getById(chainId, salonId)
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100)
    const page = Math.max(Number(opts.page) || 1, 1)
    const params: any[] = [chainId, salonId]
    let statusSql = `AND e.status <> 'superseded'`
    if (opts.status && ['active', 'paused', 'completed', 'cancelled', 'replaced'].includes(opts.status)) {
      params.push(opts.status)
      statusSql = `AND e.status = $${params.length}`
    }
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM service_chain_enrolments e WHERE e.chain_id = $1 AND e.salon_id = $2 ${statusSql}`, params)
    params.push(limit, (page - 1) * limit)
    const { rows } = await pool.query(
      `SELECT e.id, e.client_id, e.status, e.purchased_at, e.created_at,
              COALESCE(NULLIF(c.full_name, ''), TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS client_name,
              c.phone_number AS client_phone,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', m.id, 'step_order', st.step_order, 'day_offset', st.day_offset, 'delay_minutes', st.delay_minutes, 'is_sub', st.is_sub, 'service_name', sv.name,
                  'template_name', t.name, 'status', m.status, 'skip_reason', m.skip_reason,
                  'error_message', m.error_message, 'scheduled_at', m.scheduled_at, 'sent_at', m.sent_at,
                  'recheck_at', m.recheck_at, 'attempt_count', m.attempt_count, 'next_retry_at', m.next_retry_at,
                  'postponed_appointment_id', m.postponed_appointment_id, 'postponed_appointment_at', pa.scheduled_at
                ) ORDER BY st.step_order)
                FROM service_chain_messages m
                JOIN service_chain_steps st ON st.id = m.step_id
                LEFT JOIN services sv ON sv.id = st.service_id
                LEFT JOIN wa_templates t ON t.id = st.template_id
                LEFT JOIN appointments pa ON pa.id = m.postponed_appointment_id
                WHERE m.enrolment_id = e.id), '[]'::json) AS messages
       FROM service_chain_enrolments e
       JOIN clients c ON c.id = e.client_id
       WHERE e.chain_id = $1 AND e.salon_id = $2 ${statusSql}
       ORDER BY e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
    return { items: rows, total, page, limit }
  },

  async cancelEnrolment(enrolmentId: string, salonId: string) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rowCount } = await client.query(
        `UPDATE service_chain_enrolments SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND salon_id = $2 AND status IN ('active','paused')`, [enrolmentId, salonId])
      if (!rowCount) { await client.query('ROLLBACK'); throw new AppError(404, 'Active enrolment not found', 'NOT_FOUND') }
      await client.query(
        `UPDATE service_chain_messages SET status = 'CANCELLED', skip_reason = 'Cancelled by staff', updated_at = NOW()
         WHERE enrolment_id = $1 AND status IN ('SCHEDULED', 'POSTPONED')`, [enrolmentId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  },

  // Pause one client's journey: nothing is sent while it is paused, and what falls due meanwhile is skipped ("Journey was
  // paused") rather than sent late after the resume.
  async pauseEnrolment(enrolmentId: string, salonId: string) {
    const { rowCount } = await pool.query(
      `UPDATE service_chain_enrolments SET status = 'paused', updated_at = NOW() WHERE id = $1 AND salon_id = $2 AND status = 'active'`, [enrolmentId, salonId])
    if (!rowCount) throw new AppError(404, 'Running journey not found', 'NOT_FOUND')
  },

  async resumeEnrolment(enrolmentId: string, salonId: string) {
    const { rowCount } = await pool.query(
      `UPDATE service_chain_enrolments SET status = 'active', updated_at = NOW() WHERE id = $1 AND salon_id = $2 AND status = 'paused'`, [enrolmentId, salonId])
    if (!rowCount) throw new AppError(404, 'Paused journey not found', 'NOT_FOUND')
  },

  // Audit trail of one step: every state change with its reason, oldest first.
  async messageHistory(messageId: string, salonId: string) {
    const { rows } = await pool.query(
      `SELECT id, event, from_status, to_status, reason, appointment_id, created_at
       FROM service_chain_message_events WHERE message_id = $1 AND salon_id = $2 ORDER BY created_at, id`, [messageId, salonId])
    return rows
  },

  // Put a FAILED message back in the queue. The normal sender picks it up on its next 5-minute pass and re-runs every
  // check (opt-out, step before it sent, template approved), so a retry can still end up skipped for a good reason.
  async retryMessage(messageId: string, salonId: string) {
    const { rowCount } = await pool.query(
      `UPDATE service_chain_messages m
       SET status = 'SCHEDULED', scheduled_at = NOW(), attempt_count = 0, next_retry_at = NULL, error_code = NULL, error_message = NULL, skip_reason = NULL, updated_at = NOW()
       FROM service_chain_enrolments e, service_chains ch
       WHERE m.id = $1 AND m.salon_id = $2 AND m.status = 'FAILED'
         AND e.id = m.enrolment_id AND e.status = 'active'
         AND ch.id = e.chain_id AND ch.is_active AND ch.deleted_at IS NULL`, [messageId, salonId])
    if (!rowCount) throw bad('Only a failed message of a running journey can be retried')
  },
}
