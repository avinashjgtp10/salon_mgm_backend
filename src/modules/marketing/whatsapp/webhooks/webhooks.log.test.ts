import { summarizeWebhook, summarizeAccountUpdate } from "./webhooks.log";

describe("summarizeWebhook", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { display_phone_number: "919999999999", phone_number_id: "123" },
          contacts: [{ profile: { name: "Asha Customer" }, wa_id: "918888888888" }],
          messages: [{ from: "918888888888", id: "wamid.IN", type: "text", text: { body: "my secret message" } }],
          statuses: [
            { id: "wamid.A", status: "delivered", recipient_id: "918888888888" },
            { id: "wamid.B", status: "failed", recipient_id: "918888888888", errors: [{ code: 131026 }] },
          ],
        },
      }],
    }],
  };

  it("summarises event types and counts", () => {
    expect(summarizeWebhook(payload)).toEqual({
      object: "whatsapp_business_account",
      field: "messages",
      statuses: 2,
      statusTypes: { DELIVERED: 1, FAILED: 1 },
      messages: 1,
      messageTypes: { text: 1 },
    });
  });

  it("never includes phone numbers, names or message bodies", () => {
    const out = JSON.stringify(summarizeWebhook(payload));
    for (const secret of ["918888888888", "919999999999", "Asha", "my secret message", "wamid"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("tolerates malformed payloads", () => {
    expect(() => summarizeWebhook(undefined)).not.toThrow();
    expect(summarizeWebhook({ entry: "nope" }).statuses).toBe(0);
  });
});

describe("summarizeAccountUpdate", () => {
  it("keeps only limit/quality fields", () => {
    const out = summarizeAccountUpdate({
      phone_number: "919999999999",
      current_limit: "TIER_1K",
      quality_rating: "GREEN",
      event: "UPGRADE",
    });
    expect(out).toEqual({
      event: "UPGRADE",
      currentLimit: "TIER_1K",
      maxDailyLimit: undefined,
      qualityRating: "GREEN",
    });
    expect(JSON.stringify(out)).not.toContain("919999999999");
  });
});
