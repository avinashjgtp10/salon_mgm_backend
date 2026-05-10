export type WAConversation = {
  id:              string
  contact_phone:   string
  contact_name:    string | null
  last_message:    string | null
  last_message_at: string | null
  unread_count:    number
}

export type WAMessage = {
  id:              string
  conversation_id: string
  direction:       'INBOUND' | 'OUTBOUND'
  body:            string
  wamid:           string | null
  status:          'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  sent_at:         string
  delivered_at:    string | null
  read_at:         string | null
}

export type SendReplyBody = {
  message: string
}