/**
 * Log-safe summaries of WhatsApp webhook payloads. The raw payload carries
 * customer phone numbers, profile names and message bodies, so only counts,
 * event types and non-identifying status fields are ever logged.
 */

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1
    return acc
  }, {})
}

export function summarizeWebhook(body: any) {
  const changes = body?.entry?.[0]?.changes?.[0]
  const value   = changes?.value
  const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : []
  const messages: any[] = Array.isArray(value?.messages) ? value.messages : []

  return {
    object:       typeof body?.object === 'string' ? body.object : undefined,
    field:        typeof changes?.field === 'string' ? changes.field : undefined,
    statuses:     statuses.length,
    statusTypes:  countBy(statuses.map(s => String(s?.status ?? 'unknown').toUpperCase())),
    messages:     messages.length,
    messageTypes: countBy(messages.map(m => String(m?.type ?? 'unknown'))),
  }
}

export function summarizeAccountUpdate(value: any) {
  return {
    event:          typeof value?.event === 'string' ? value.event : undefined,
    currentLimit:   value?.current_limit,
    maxDailyLimit:  value?.max_daily_conversations_per_business ?? value?.max_daily_conversation_per_phone,
    qualityRating:  value?.quality_rating ?? value?.quality_score,
  }
}
