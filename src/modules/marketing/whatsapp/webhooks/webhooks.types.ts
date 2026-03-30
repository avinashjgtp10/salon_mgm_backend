export type WAWebhookEvent = {
  id:            string
  phone:         string
  name:          string | null
  status:        string
  wamid:         string | null
  campaign_id:   string
  campaign_name: string
  sent_at:       string | null
  delivered_at:  string | null
  read_at:       string | null
  updated_at:    string
}
