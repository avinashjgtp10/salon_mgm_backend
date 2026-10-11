import axios from 'axios'
import FormData from 'form-data'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v22.0'

// Every Meta call goes through this instance so none can hang indefinitely — a
// stuck request would otherwise tie up a campaign worker slot (concurrency 10)
// or block a synchronous saveConfig/testConnection during a Meta outage.
const http = axios.create({ timeout: 30_000 })

const TIER_LIMIT_MAP: Record<string, number> = {
  TIER_50:        50,
  TIER_250:       250,
  TIER_1K:        1000,
  TIER_2K:        2000,
  TIER_10K:       10000,
  TIER_100K:      100000,
  NOT_APPLICABLE: 0,
  NOT_SET:        0,
}

export const whatsappMetaApi = {

  async sendTemplateMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    templateName:  string
    language:      string
    components:    any[]
  }) {
    const template: any = {
      name:     params.templateName,
      language: { code: params.language },
    }
    if (params.components?.length > 0) template.components = params.components
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: 'template', template },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  async sendTextMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    message:       string
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: 'text', text: { body: params.message } },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Interactive list message — like sendTextMessage, only deliverable within
  // 24h of the customer's last inbound message (Meta's "service window").
  // Used for the star-rating prompt: only sent after the customer has
  // already replied to review_request, which is what opens that window.
  async sendInteractiveListMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    bodyText:      string
    buttonText:    string
    sectionTitle:  string
    rows:          Array<{ id: string; title: string; description?: string }>
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                params.to,
        type:              'interactive',
        interactive: {
          type:   'list',
          body:   { text: params.bodyText },
          action: {
            button:   params.buttonText,
            sections: [{ title: params.sectionTitle, rows: params.rows }],
          },
        },
      },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Uploads a file's raw bytes directly to Meta (no publicly-fetchable URL
  // needed) — returns a media id good for one send. Preferred over the
  // link-based document/header params below: a `link` requires Meta's
  // servers to fetch it themselves, which silently breaks behind anything
  // that intercepts the request before it reaches the real file (e.g. a free
  // ngrok tunnel's browser-warning interstitial, or the tunnel just being
  // offline) — Meta ends up "sending" whatever HTML that intermediary
  // returned instead of the real document.
  async uploadMedia(params: {
    phoneNumberId: string
    accessToken:   string
    buffer:        Buffer
    filename:      string
    mimeType:      string
  }): Promise<string> {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', params.mimeType)
    form.append('file', params.buffer, { filename: params.filename, contentType: params.mimeType })

    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/media`,
      form,
      { headers: { Authorization: `Bearer ${params.accessToken}`, ...form.getHeaders() } }
    )
    if (!res.data.id) throw new Error('No media ID returned from Meta')
    return res.data.id
  },

  // Free-form media message (image / video / audio / document) from a media id
  // returned by uploadMedia. Like any non-template message it is only
  // deliverable inside the 24h service window.
  async sendMediaMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    type:          'image' | 'video' | 'audio' | 'document'
    mediaId:       string
    caption?:      string
    filename?:     string
  }) {
    const media: Record<string, any> = { id: params.mediaId }
    if (params.caption && params.type !== 'audio')   media.caption  = params.caption
    if (params.filename && params.type === 'document') media.filename = params.filename
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: params.type, [params.type]: media },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Emoji reaction to a message (pass emoji '' to remove ours).
  async sendReaction(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    messageId:     string
    emoji:         string
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: 'reaction',
        reaction: { message_id: params.messageId, emoji: params.emoji },
      },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Freeform document message — only deliverable within 24h of the customer's
  // last inbound message (Meta's "service window"). Outside that window this
  // requires a pre-approved media-header template instead; the caller should
  // treat a failure here as expected, not fatal, and fall back to text-only.
  // Pass mediaId (via uploadMedia above) whenever you have the file's bytes —
  // link is kept only for a caller that genuinely has nothing but a URL.
  async sendDocumentMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    link?:         string
    mediaId?:      string
    filename:      string
    caption?:      string
  }) {
    if (!params.link && !params.mediaId) {
      throw new Error('sendDocumentMessage requires either link or mediaId')
    }
    const document: Record<string, any> = params.mediaId
      ? { id: params.mediaId, filename: params.filename }
      : { link: params.link, filename: params.filename }
    if (params.caption) document.caption = params.caption

    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                params.to,
        type:               'document',
        document,
      },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },
  async verifyPhoneNumberId(params: {
  phoneNumberId: string
  accessToken:   string
}): Promise<{ valid: boolean; displayPhone?: string; verifiedName?: string; error?: string }> {
  try {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}`,
      {
        params: { fields: 'display_phone_number,verified_name,quality_rating,status' },
        headers: { Authorization: `Bearer ${params.accessToken}` },
      }
    )
    return {
      valid:        true,
      displayPhone: res.data.display_phone_number,
      verifiedName: res.data.verified_name,
    }
  } catch (err: any) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message ?? 'Invalid Phone Number ID or Access Token',
    }
  }
},

async verifyWabaId(params: {
  wabaId:      string
  accessToken: string
}): Promise<{ valid: boolean; name?: string; error?: string }> {
  try {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}`,
      {
        params: { fields: 'name,currency,timezone_id' },
        headers: { Authorization: `Bearer ${params.accessToken}` },
      }
    )
    return { valid: true, name: res.data.name }
  } catch (err: any) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message ?? 'Invalid WABA ID or Access Token',
    }
  }
},

async verifyAppCredentials(params: {
  appId:     string
  appSecret: string
}): Promise<{ valid: boolean; appName?: string; error?: string }> {
  try {
    const appToken = `${params.appId}|${params.appSecret}`
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.appId}`,
      {
        params: { fields: 'name,category', access_token: appToken },
      }
    )
    return { valid: true, appName: res.data.name }
  } catch (err: any) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message ?? 'Invalid App ID or App Secret',
    }
  }
},

async verifyAccessToken(params: {
  accessToken: string
}): Promise<{ valid: boolean; permissions?: string[]; error?: string }> {
  try {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/me/permissions`,
      {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      }
    )
    const perms = (res.data.data ?? [])
      .filter((p: any) => p.status === 'granted')
      .map((p: any) => p.permission)

    const required = ['whatsapp_business_messaging', 'whatsapp_business_management']
    const missing  = required.filter(r => !perms.includes(r))

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing permissions: ${missing.join(', ')}. Enable them when generating the System User token.`,
      }
    }
    return { valid: true, permissions: perms }
  } catch (err: any) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message ?? 'Invalid or expired Access Token',
    }
  }
},

  async submitTemplate(params: {
    wabaId:      string
    accessToken: string
    name:        string
    category:    string
    language:    string
    components:  any[]
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/message_templates`,
      { name: params.name, category: params.category, language: params.language, components: params.components },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  async getTemplateStatus(accessToken: string, metaTemplateId: string) {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${metaTemplateId}`,
      // category included so a sync can pick up Meta silently reclassifying
      // a template post-submission (e.g. a UTILITY submission Meta approves
      // but recategorizes as MARKETING) — without it here, our own stored
      // category never has a way to learn it's gone stale.
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'id,name,status,category,quality_score,rejected_reason' } }
    )
    return res.data
  },

  // Creates (and optionally publishes) a WhatsApp Flow under the WABA. Meta
  // returns { id, success, validation_errors? } - a flow with validation errors
  // is left as a draft, so the caller must check validation_errors.
  async createFlow(params: {
    wabaId:      string
    accessToken: string
    name:        string
    flowJson:    object
    publish:     boolean
    categories?: string[]
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/flows`,
      {
        name:       params.name,
        categories: params.categories ?? ['APPOINTMENT_BOOKING'],
        flow_json:  JSON.stringify(params.flowJson),
        publish:    params.publish,
      },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Sends a published Flow as an interactive message - only deliverable inside
  // the 24h service window, like any non-template message.
  async sendFlowMessage(params: {
    phoneNumberId: string
    accessToken:   string
    to:            string
    flowId:        string
    flowToken:     string
    screen:        string
    bodyText:      string
    buttonText:    string
  }) {
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                params.to,
        type:              'interactive',
        interactive: {
          type: 'flow',
          body: { text: params.bodyText },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token:           params.flowToken,
              flow_id:              params.flowId,
              flow_cta:             params.buttonText,
              flow_action:          'navigate',
              flow_action_payload:  { screen: params.screen },
            },
          },
        },
      },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  // Downloads a media object by its Meta media id (two hops: id → short-lived
  // url, then the bytes — both need the bearer token). Meta keeps an uploaded
  // media id for ~30 days, after which this 404s.
  // Marks a customer message as read on WhatsApp (blue ticks on their phone —
  // Meta treats everything up to this message as read). With typing:true it also
  // shows "typing…" on their side for up to 25s or until we send something.
  async markAsRead(params: {
    phoneNumberId: string
    accessToken:   string
    messageId:     string
    typing?:       boolean
  }) {
    const payload: any = { messaging_product: 'whatsapp', status: 'read', message_id: params.messageId }
    if (params.typing) payload.typing_indicator = { type: 'text' }
    const res = await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  async downloadMedia(accessToken: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const meta = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const url: string | undefined = meta.data?.url
    if (!url) throw new Error('Meta returned no media url')
    const file = await http.get(url, {
      headers:      { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
    })
    return {
      buffer:   Buffer.from(file.data),
      mimeType: meta.data?.mime_type ?? file.headers?.['content-type'] ?? 'application/octet-stream',
    }
  },

  // The sample file a template was submitted with — lives on Meta for as long
  // as the template does, so it outlives the 30-day media id above.
  async getTemplateHeaderExample(accessToken: string, metaTemplateId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${metaTemplateId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'components' } }
    )
    const header = (res.data?.components ?? []).find((c: any) => c.type === 'HEADER')
    const exampleUrl: string | undefined = header?.example?.header_handle?.[0]
    if (!exampleUrl) return null
    const file = await http.get(exampleUrl, { responseType: 'arraybuffer' })
    return {
      buffer:   Buffer.from(file.data),
      mimeType: String(file.headers?.['content-type'] ?? 'application/octet-stream'),
    }
  },

  async testConnection(phoneNumberId: string, accessToken: string) {
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { fields: 'display_phone_number,quality_rating,whatsapp_business_manager_messaging_limit' },
      }
    )
    return res.data
  },

  async fetchPhoneNumberLimits(
    phoneNumberId: string,
    accessToken:   string,
    wabaId:        string
  ): Promise<{ quality_rating: string; daily_limit: number; raw: any }> {

    try {
      const res = await http.get(
        `${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { fields: 'quality_rating,whatsapp_business_manager_messaging_limit' },
        }
      )
      const data     = res.data
      const rawLimit = data.whatsapp_business_manager_messaging_limit as string | undefined
      const quality  = (data.quality_rating as string) ?? 'GREEN'

      if (rawLimit) {
        const fromMap = TIER_LIMIT_MAP[rawLimit]
        const fromNum = Number(rawLimit)
        const daily   = fromMap !== undefined ? fromMap : (!isNaN(fromNum) ? fromNum : 0)
        if (daily > 0) return { quality_rating: quality, daily_limit: daily, raw: data }
      }
    } catch (err: any) {}

    try {
      const res = await http.get(
        `${WA_BASE_URL}/${WA_API_VERSION}/${wabaId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { fields: 'max_daily_conversations_per_business' },
        }
      )
      const limit = res.data?.max_daily_conversations_per_business
      if (limit && !isNaN(Number(limit))) {
        return { quality_rating: 'GREEN', daily_limit: Number(limit), raw: res.data }
      }
    } catch (err: any) {}

    try {
      const res = await http.get(
        `${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { fields: 'messaging_limit_tier,quality_rating' },
        }
      )
      const tier  = res.data?.messaging_limit_tier as string | undefined
      const daily = tier ? (TIER_LIMIT_MAP[tier] ?? 0) : 0
      if (daily > 0) return { quality_rating: res.data?.quality_rating ?? 'GREEN', daily_limit: daily, raw: res.data }
    } catch (err: any) {}

    return { quality_rating: 'GREEN', daily_limit: 0, raw: {} }
  },

  async registerWebhook(params: {
    appId:       string
    appToken:    string
    callbackUrl: string
    verifyToken: string
  }) {
    await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.appId}/subscriptions`,
      null,
      {
        params: {
          object:       'whatsapp_business_account',
          callback_url: params.callbackUrl,
          verify_token: params.verifyToken,
          // "messages" alone covers both inbound messages AND delivery/read
          // status callbacks (Meta delivers statuses as part of the same
          // field's payload) — "message_status_updates" is not a real Meta
          // webhook field name and caused the whole subscribe call to be
          // rejected with a permissions error, which in turn skipped the
          // subscribeWaba() call right after it (same try block).
          fields:       'messages',
          access_token: params.appToken,
        },
      }
    )
  },

  async subscribeWaba(params: { wabaId: string; accessToken: string }) {
    await http.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/subscribed_apps`,
      {},
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
  },

  async unsubscribeWaba(params: { wabaId: string; accessToken: string }) {
    await http.delete(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${params.accessToken}` } }
    )
  },

  // ── OLD: conversation-based analytics (deprecated July 2025, kept as fallback) ──
  async fetchWabaAnalytics(params: {
    wabaId:      string
    accessToken: string
    start:       number
    end:         number
    granularity: 'HALF_HOUR' | 'DAILY' | 'MONTHLY'
  }) {
    const fieldStr =
      `conversation_analytics.start(${params.start})` +
      `.end(${params.end})` +
      `.granularity(${params.granularity})` +
      `.dimensions(["conversation_type"])`
    const res = await http.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}`,
      { headers: { Authorization: `Bearer ${params.accessToken}` }, params: { fields: fieldStr } }
    )
    return res.data
  },

  // ── NEW: per-message pricing analytics (replaces conversation_analytics July 2025) ──
  // Returns actual billed amounts per message type under the new PMP model
  async fetchPricingAnalytics(params: {
  wabaId:      string
  accessToken: string
  start:       number
  end:         number
  granularity: 'HALF_HOUR' | 'DAILY' | 'MONTHLY'
}) {
  const fieldStr =
    `pricing_analytics.start(${params.start})` +
    `.end(${params.end})` +
    `.granularity(${params.granularity})` +
    `.dimensions(["PRICING_CATEGORY"])`   // ← was "conversation_category", now "PRICING_CATEGORY"

  const res = await http.get(
    `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}`,
    {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      params:  { fields: fieldStr },
    }
  )
  return res.data
},
}