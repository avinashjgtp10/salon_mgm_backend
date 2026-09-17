// ============================================================
// SalonOx — Public booking: request validation
// ============================================================
//
// POST /api/v1/bookings is the only unauthenticated write endpoint in the
// product: anyone with a salon's booking link can reach it, and every call
// creates a client record and an appointment. It previously ran on nothing but
// five presence checks in the controller, so a malformed or hostile payload got
// as far as the database before anything objected.
//
// Everything here is shape/format only — whether the *time* is bookable, the
// stylist is eligible, or the salon is published are business rules decided in
// bookings.service.ts against live data, not here.

import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately permissive: rejects obvious non-addresses, doesn't adjudicate
// RFC 5322. SMTP gets the final say.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// A booking can legitimately bundle several services, but not dozens — a large
// array is either a bug or someone probing. 20 is far above real usage.
const MAX_SERVICES_PER_BOOKING = 20;
const MAX_NOTES_LENGTH = 1000;
const MAX_NAME_LENGTH = 120;

const fail = (message: string): never => {
  throw new AppError(400, message, "VALIDATION_ERROR");
};

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

export const validateCreateBooking = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};

    // ── Salon ────────────────────────────────────────────────────────────────
    if (!isNonEmptyString(b.salon_id) || !UUID_RE.test(b.salon_id.trim())) {
      fail("salon_id must be a valid UUID");
    }

    // ── Services ─────────────────────────────────────────────────────────────
    if (!Array.isArray(b.service_ids) || b.service_ids.length === 0) {
      fail("service_ids must be a non-empty array");
    }
    if (b.service_ids.length > MAX_SERVICES_PER_BOOKING) {
      fail(`A booking cannot contain more than ${MAX_SERVICES_PER_BOOKING} services`);
    }
    if (!b.service_ids.every((id: unknown) => isNonEmptyString(id) && UUID_RE.test(id.trim()))) {
      fail("Each service_id must be a valid UUID");
    }
    // Duplicates would double-count duration and price against one appointment.
    if (new Set(b.service_ids.map((id: string) => id.trim().toLowerCase())).size !== b.service_ids.length) {
      fail("service_ids must not contain duplicates");
    }

    // ── Staff (optional — absent means "any available stylist") ───────────────
    if (b.staff_id !== undefined && b.staff_id !== null && b.staff_id !== "") {
      if (!isNonEmptyString(b.staff_id) || !UUID_RE.test(b.staff_id.trim())) {
        fail("staff_id must be a valid UUID when provided");
      }
    }

    // ── When ─────────────────────────────────────────────────────────────────
    if (!isNonEmptyString(b.scheduled_at)) fail("scheduled_at is required");
    const when = new Date(b.scheduled_at);
    if (Number.isNaN(when.getTime())) fail("scheduled_at must be a valid ISO 8601 date-time");
    // A sanity ceiling only. "Too far ahead" per the salon's own max-advance
    // setting is enforced in the service, against that salon's configuration.
    const tenYears = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    if (when.getTime() > tenYears) fail("scheduled_at is unreasonably far in the future");

    // ── Customer ─────────────────────────────────────────────────────────────
    if (!isNonEmptyString(b.client_name)) fail("client_name is required");
    if (b.client_name.trim().length > MAX_NAME_LENGTH) {
      fail(`client_name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }

    if (!isNonEmptyString(b.client_phone)) fail("client_phone is required");
    const phoneDigits = String(b.client_phone).replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      fail("client_phone must contain between 7 and 15 digits");
    }

    // Email is optional, but a value that's present must be usable — otherwise
    // the confirmation silently fails later instead of being caught here.
    if (b.client_email !== undefined && b.client_email !== null && String(b.client_email).trim() !== "") {
      if (!EMAIL_RE.test(String(b.client_email).trim())) {
        fail("client_email must be a valid email address");
      }
    }

    if (b.notes !== undefined && b.notes !== null) {
      if (typeof b.notes !== "string") fail("notes must be a string");
      if (b.notes.length > MAX_NOTES_LENGTH) {
        fail(`notes must be ${MAX_NOTES_LENGTH} characters or fewer`);
      }
    }

    if (b.client_gender !== undefined && b.client_gender !== null && b.client_gender !== "") {
      if (!["male", "female", "other"].includes(String(b.client_gender).toLowerCase())) {
        fail("client_gender must be male, female or other");
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

// ── Availability query ────────────────────────────────────────────────────────
// Public and uncached, so it's worth keeping the inputs tight: this endpoint
// fans out into several date-range queries per call.
export const validateAvailabilityQuery = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { salon_id } = req.params;
    const { date, staffId, durationMinutes } = req.query;

    if (!salon_id || !UUID_RE.test(String(salon_id))) fail("salon_id must be a valid UUID");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fail("date must be in YYYY-MM-DD format");
    if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) fail("date is not a real calendar date");

    if (staffId !== undefined && !UUID_RE.test(String(staffId))) {
      fail("staffId must be a valid UUID when provided");
    }
    if (durationMinutes !== undefined) {
      const n = Number(durationMinutes);
      if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) {
        fail("durationMinutes must be between 1 and 1440");
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

// ── Manage-booking bodies ─────────────────────────────────────────────────────

export const validateManageToken = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { appointmentId } = req.params;
    if (!appointmentId || !UUID_RE.test(String(appointmentId))) {
      fail("appointmentId must be a valid UUID");
    }
    const token = String(req.body?.token || req.query?.token || "");
    // The signature itself is verified in the service; this only rejects
    // obviously malformed input before any lookup happens.
    if (!/^[0-9a-f]{64}$/i.test(token)) fail("A valid management token is required");
    return next();
  } catch (err) {
    return next(err);
  }
};

export const validateReschedule = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (!isNonEmptyString(req.body?.scheduled_at)) fail("scheduled_at is required");
    if (Number.isNaN(new Date(req.body.scheduled_at).getTime())) {
      fail("scheduled_at must be a valid ISO 8601 date-time");
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

export const validateCancel = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (req.body?.reason !== undefined && req.body.reason !== null) {
      if (typeof req.body.reason !== "string") fail("reason must be a string");
      if (req.body.reason.length > 500) fail("reason must be 500 characters or fewer");
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
