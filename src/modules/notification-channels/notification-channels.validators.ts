// ============================================================
// SalonOx — Notification Channel Templates: Validation
// ============================================================

import { AppError } from "../../middleware/error.middleware"
import { AutomationEventType } from "../whatsapp-automation/whatsapp-automation.types"
import { DefaultPurchaseEventType, EVENT_VARIABLE_NAMES } from "./notification-channels-defaults"

// Rejects only {{tokens}} that aren't a recognized variable for this event —
// catches typos before they render as a literal blank. Deliberately does
// NOT require every variable to appear (unlike wa-automation-defaults.ts's
// validateNamedPlaceholders, which also enforces that — a Meta {{n}}-
// numbering constraint that doesn't apply here). A genuinely short SMS
// summary is expected to omit some variables on purpose — see bill_receipt.
export function validateKnownPlaceholdersOnly(text: string, eventType: AutomationEventType): void {
  const names = EVENT_VARIABLE_NAMES[eventType as DefaultPurchaseEventType]
  if (!names) return
  const nameSet = new Set(names.map((n) => n.toLowerCase()))

  const found = [...text.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase())
  const unknown = [...new Set(found.filter((n) => !nameSet.has(n)))]
  if (unknown.length > 0) {
    throw new AppError(400, `Unknown variable(s): ${unknown.map((n) => `{{${n}}}`).join(", ")}`, "VALIDATION_ERROR")
  }
}

export function requirePurchaseEvent(eventType: string): DefaultPurchaseEventType {
  if (!(eventType in EVENT_VARIABLE_NAMES)) {
    throw new AppError(400, `"${eventType}" is not a notification-channel-template event type`, "VALIDATION_ERROR")
  }
  return eventType as DefaultPurchaseEventType
}

export function validateSmsBody(body: string, eventType: AutomationEventType, enabled: boolean): void {
  if (enabled && !body.trim()) {
    throw new AppError(400, "SMS wording cannot be empty while SMS is enabled", "VALIDATION_ERROR")
  }
  validateKnownPlaceholdersOnly(body, eventType)
}

export function validateEmailContent(subject: string, body: string, eventType: AutomationEventType, enabled: boolean): void {
  if (enabled && !subject.trim()) {
    throw new AppError(400, "Email subject is required while Email is enabled", "VALIDATION_ERROR")
  }
  if (enabled && !body.trim()) {
    throw new AppError(400, "Email body cannot be empty while Email is enabled", "VALIDATION_ERROR")
  }
  validateKnownPlaceholdersOnly(subject, eventType)
  validateKnownPlaceholdersOnly(body, eventType)
}
