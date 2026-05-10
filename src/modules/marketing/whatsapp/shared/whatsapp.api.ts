import axios from 'axios'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v19.0'

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
    if (params.components?.length > 0) {
      template.components = params.components
    }
    const res = await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                params.to,
        type:              'template',
        template,
      },
      {
        headers: {
          Authorization:  `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
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
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                params.to,
        type:              'text',
        text:              { body: params.message },
      },
      {
        headers: {
          Authorization:  `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )
    return res.data
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
      {
        name:       params.name,
        category:   params.category,
        language:   params.language,
        components: params.components,
      },
      {
        headers: {
          Authorization:  `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )
    return res.data
  },

  async getTemplateStatus(accessToken: string, metaTemplateId: string) {
    const res = await axios.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${metaTemplateId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { fields: 'id,name,status,quality_score,rejected_reason' },
      }
    )
    return res.data
  },

  async testConnection(phoneNumberId: string, accessToken: string) {
    const res = await axios.get(
      `${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { fields: 'display_phone_number,quality_rating,messaging_limit_tier' },
      }
    )
    return res.data
  },

  // ── Auto-register webhook ─────────────────────────────────────────────────
  // Uses app access token (app_id|app_secret) which has the correct permissions
  // to register app-level webhook subscriptions — regular user tokens won't work.
  async registerWebhook(params: {
    appId:       string
    appToken:    string  // app_id|app_secret format
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

  // Subscribe the WABA to the app so it receives webhook events
  async subscribeWaba(params: {
    wabaId:      string
    accessToken: string
  }) {
    await axios.post(
      `${WA_BASE_URL}/${WA_API_VERSION}/${params.wabaId}/subscribed_apps`,
      {},
      {
        headers: {
          Authorization:  `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )
  },
}