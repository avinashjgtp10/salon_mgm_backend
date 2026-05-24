import axios from 'axios'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v21.0'

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
    const res = await axios.post(
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
    const res = await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: 'text', text: { body: params.message } },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },
  async verifyPhoneNumberId(params: {
  phoneNumberId: string
  accessToken:   string
}): Promise<{ valid: boolean; displayPhone?: string; verifiedName?: string; error?: string }> {
  try {
    const res = await axios.get(
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
    const res = await axios.get(
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
    const res = await axios.get(
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
    const res = await axios.get(
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
    const res = await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/message_templates`,
      { name: params.name, category: params.category, language: params.language, components: params.components },
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return res.data
  },

  async getTemplateStatus(accessToken: string, metaTemplateId: string) {
    const res = await axios.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${metaTemplateId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'id,name,status,quality_score,rejected_reason' } }
    )
    return res.data
  },

  async testConnection(phoneNumberId: string, accessToken: string) {
    const res = await axios.get(
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
      const res = await axios.get(
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
      const res = await axios.get(
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
      const res = await axios.get(
        `${WA_BASE_URL}/v20.0/${phoneNumberId}`,
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
    await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.appId}/subscriptions`,
      null,
      {
        params: {
          object:       'whatsapp_business_account',
          callback_url: params.callbackUrl,
          verify_token: params.verifyToken,
          fields:       'messages,message_status_updates',
          access_token: params.appToken,
        },
      }
    )
  },

  async subscribeWaba(params: { wabaId: string; accessToken: string }) {
    await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/subscribed_apps`,
      {},
      { headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' } }
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
    const res = await axios.get(
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

  const res = await axios.get(
    `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}`,
    {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      params:  { fields: fieldStr },
    }
  )
  return res.data
},
}