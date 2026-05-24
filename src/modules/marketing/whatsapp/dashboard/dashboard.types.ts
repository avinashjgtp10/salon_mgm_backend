export type WADashboardStats = {
  totalCampaigns:     number
  activeCampaigns:    number
  completedCampaigns: number
  totalMessagesSent:  number
  totalSent:          number
  totalDelivered:     number
  totalRead:          number
  totalFailed:        number
  totalBlocked:       number
  totalContacts:      number
  deliveryRate:       number
  readRate:           number
  dailyVolume:        { date: string; count: number }[]
  recentCampaigns:    WARecentCampaign[]
  topCampaigns:       WATopCampaign[]
  topTemplates:       WATopTemplate[]
  engagedContacts:    WAEngagedContact[]
}

export type WARecentCampaign = {
  id:              string
  name:            string
  status:          string
  total_contacts:  number
  sent_count:      number
  delivered_count: number
  read_count:      number
  failed_count:    number
  blocked_count:   number
  created_at:      string
  completed_at:    string | null
}

export type WATopCampaign = {
  id:              string
  name:            string
  status:          string
  sent_count:      number
  delivered_count: number
  read_count:      number
  failed_count:    number
  total_contacts:  number
  delivery_rate:   number
  read_rate:       number
  created_at:      string
}

export type WATopTemplate = {
  template_id:     string
  template_name:   string
  times_used:      number
  total_sent:      number
  total_delivered: number
  total_read:      number
  avg_read_rate:   number
}

export type WAEngagedContact = {
  phone:          string
  name:           string | null
  campaigns_read: number
  total_received: number
  read_rate:      number
  last_read_at:   string | null
}