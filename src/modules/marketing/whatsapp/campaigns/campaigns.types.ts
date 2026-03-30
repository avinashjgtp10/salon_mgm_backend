export type WACampaignStatus = 'DRAFT' | 'SENDING' | 'PAUSED' | 'COMPLETED' | 'FAILED'
export type WAContactStatus  = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'BLOCKED'

export type WACampaign = {
  id:             string
  salon_id:       string
  template_id:    string
  template_name?: string
  template_body?: string
  name:           string
  status:         WACampaignStatus
  batch_size:     number
  total_contacts: number
  sent_count:     number
  delivered_count: number
  read_count:     number
  failed_count:   number
  blocked_count:  number
  scheduled_at:   string | null
  started_at:     string | null
  completed_at:   string | null
  created_at:     string
  updated_at:     string
}

export type WACampaignContact = {
  id:            string
  campaign_id:   string
  phone:         string
  name:          string | null
  variables:     Record<string, any>
  status:        WAContactStatus
  wamid:         string | null
  error_code:    string | null
  error_message: string | null
  sent_at:       string | null
  delivered_at:  string | null
  read_at:       string | null
  created_at:    string
  updated_at:    string
}

export type CreateCampaignBody = {
  name:        string
  template_id: string
  batch_size?: number
  contacts:    Array<{
    phone:       string
    name?:       string | null
    variables?:  Record<string, any>
  }>
}

export type ReportType = 'successful' | 'failed' | 'blocked'
