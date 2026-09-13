// ─── Client phone matching key ───────────────────────────────────────────────
// One normalizer, used by every "is this the same client?" comparison, because
// the two places that used to ask that question each had their own rule and
// they disagreed:
//
//   * the bulk-billing importer keyed its lookup map on
//     phone.replace(/[\s\-().]/g, "") — which strips spaces/dashes/parens/dots
//     but leaves a "+", a "91" country prefix and a leading "0" intact;
//   * clientsRepository.findActiveByPhoneOrEmail (the guard that enforces "one
//     active client per phone number") compared TRIM(phone_number) as an exact
//     string.
//
// So "+919876543210" and "9876543210" were two different people to the
// importer, AND the duplicate guard also failed to catch it, because the raw
// strings genuinely differ. A sheet that mixed the two formats — routine in a
// historical export — created two client rows holding one real number.
//
// The key is the last 10 digits: that drops a "+", a "91"/"0" prefix and any
// punctuation in one step, while leaving shorter (already non-standard)
// numbers alone rather than padding or rejecting them. Two genuinely different
// numbers sharing their last 10 digits within a single salon isn't a case
// worth designing around.
export function clientPhoneKey(raw: unknown): string {
    const digits = String(raw ?? "").replace(/[^0-9]/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
}

// SQL that produces clientPhoneKey() for a `clients` row, so the DB-side
// comparison agrees with the JS-side one exactly. Kept next to the function it
// mirrors — if one changes, the other has to. Note this is not index-backed;
// at a few thousand clients per salon the scan is cheap, and every caller is
// either a single create or a one-off duplicate lookup.
export const CLIENT_PHONE_KEY_SQL =
    `RIGHT(REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '', 'g'), 10)`;
