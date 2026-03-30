export type WADashboardStats = {
  totalCampaigns:    number
  totalMessagesSent: number
  totalDelivered:    number
  totalRead:         number
  totalFailed:       number
  totalBlocked:      number
  deliveryRate:      number
  readRate:          number
  recentCampaigns:   WARecentCampaign[]
}

export type WARecentCampaign = {
  id:             string
  name:           string
  status:         string
  total_contacts: number
  sent_count:     number
  delivered_count: number
  read_count:     number
  failed_count:   number
  blocked_count:  number
  created_at:     string
  completed_at:   string | null
}
