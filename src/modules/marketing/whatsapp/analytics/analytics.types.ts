export interface AnalyticsQuery {
  start:        string  // YYYY-MM-DD
  end:          string  // YYYY-MM-DD
  granularity?: 'DAILY' | 'MONTHLY'
}

export interface DailySpend {
  date:               string
  marketing:          number
  utility:            number
  authentication:     number
  service:            number
  totalMessages:      number
  totalConversations: number
  estimatedCost:      number
}

export interface WAAnalyticsStats {
  totalConversations:  number
  totalMessages:       number
  totalEstimatedCost:  number
  pricingModel:        'PMP' | 'CBP'
  currency:            string
  byCategory: {
    marketing:      number
    utility:        number
    authentication: number
    service:        number
  }
  byCategoryCost: {
    marketing:      number
    utility:        number
    authentication: number
    service:        number
  }
  daily:       DailySpend[]
  periodStart: string
  periodEnd:   string
}