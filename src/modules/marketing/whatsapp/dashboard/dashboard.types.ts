export type WADashboardStats = {
  totalCampaigns:    number
  activeCampaigns:   number
  totalMessagesSent: number
  totalSent:         number  // alias for totalMessagesSent
  totalDelivered:    number
  totalRead:         number
  totalFailed:       number
  totalBlocked:      number
  totalContacts:     number
  deliveryRate:      number
  readRate:          number
  dailyVolume:       { date: string; count: number }[]
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