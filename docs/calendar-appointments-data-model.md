# Calendar / Appointments — Data Model Reference

**Purpose of this document**: this is the single source of truth for how calendar
data flows through the system — where it comes from, where it's stored, and how
to correctly read money/status fields (paid, due, booked, cancelled, etc.).
Written after a full audit + refactor session (see git history on both repos for
the commits this describes). If you're about to explore the calendar/appointments
code, read this first — it should answer almost everything without needing to
grep the codebase.

Last verified against the live dev database (`salonoxdb_dev`, Postgres 17.9,
AWS RDS) and the current state of both repos as of this session.

---

## 1. The core fact: there is no separate "calendar"

"Calendar" is not its own table, database, or backend module. It is a UI/view
over one single table: **`appointments`**, in the one shared Postgres database
(`salonoxdb_dev`, ~40 MB total, 121 tables — everything for the whole app lives
in this one DB).

- Backend route `/api/v1/calendar/*` is a **dead alias** — `calendar.routes.ts`
  literally does `export { default } from "../appointments/appointments.routes"`.
  The real, live route prefix is `/api/v1/appointments`.
- There used to be a second, fully independent "calendar" implementation on the
  frontend (`src/store/calendarSlice.ts`, `src/store/bookingSlice.ts`,
  `src/types/calendar.types.ts`, `src/middleware/calendar/calendar.thunk.ts`) —
  this was **confirmed dead** (zero live imports anywhere) and **deleted** in
  this session. If you see references to it in old docs/memory, it's gone now.

---

## 2. The `appointments` table — full schema

Backend module: `salon_mgm_backend/src/modules/appointments/` (`appointments.types.ts`,
`.repository.ts`, `.service.ts`, `.controller.ts`, `.routes.ts`, `.validator.ts`,
`.scheduler.ts`).

No baseline migration exists for this table in git — it was created directly
against the DB before migration tracking started. The columns below were
confirmed by live introspection (`information_schema.columns` / `pg_constraint`
/ `pg_enum`), not just by reading code.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `gen_random_uuid()` |
| `salon_id` | uuid, NOT NULL | |
| `branch_id` | uuid, nullable | FK → `branches(id)` |
| `client_id` | uuid, nullable | |
| `staff_id` | uuid, nullable | |
| `service_id` | uuid, nullable | **Vestigial** — real per-service data lives in the `services` JSONB column below; this single FK can't represent a multi-service appointment. Don't rely on it. |
| `title` | varchar, NOT NULL, default `'Appointment'` | |
| `notes` | text, nullable | |
| `staff_alert` | text, nullable | |
| `status` | **native Postgres ENUM `appointment_status`**, NOT NULL, default `'booked'` | See §4 — this is the single most important column. **Not a VARCHAR + CHECK constraint.** |
| `scheduled_at` | timestamptz, NOT NULL | |
| `duration_minutes` | int, NOT NULL | CHECK `> 0` |
| `ends_at` | timestamptz, NOT NULL | Auto-computed server-side as `scheduled_at + duration_minutes` on every insert/update — never send this from the client, it's overwritten anyway. |
| `colour` | varchar, nullable | |
| `sale_id` | uuid, nullable | Set once, at checkout — see §5. |
| `created_by` | uuid, nullable | |
| `created_at` / `updated_at` | timestamptz, NOT NULL | |
| `cancelled_at` | timestamptz, nullable | **Dead** — column exists, declared on the TS type, but `cancel()` never writes it. Always NULL. |
| `cancel_reason` | text, nullable | **Dead**, same as above. |
| `services` | jsonb, default `'[]'` | Array of `{service_id, staff_id, name, price, quantity, time, is_package_service}` — the real service line items. |
| `package_items` | jsonb, default `'[]'` | Same shape idea, for packages. |
| `product_items` | jsonb, default `'[]'` | Products sold on this visit. |
| `membership_items` | jsonb, default `'[]'` | Memberships sold on this visit. |
| `due_amount` | numeric, default `0` | **Dead / never written by any INSERT or UPDATE in the codebase.** Always 0 or NULL. **Do not use this to determine what a client owes** — see §6. |
| `discount_value` / `discount_type` | numeric / varchar | Pre-payment estimate, `discount_type` CHECK IN `('percentage','flat')`. |
| `ex_charges` | numeric, default 0 | |
| `tip_amount` | numeric, default 0 | |
| `gst_percent` | numeric, default 0 | |
| `apply_membership_wallet` | boolean, NOT NULL, default false | Persisted "Apply Membership" checkbox state. |
| `deleted_at` | timestamptz, nullable | Soft-delete marker. Set by `deleteById()`. |
| ~~`service_started_at`~~ / ~~`service_ended_at`~~ | — | **Dropped.** The check-in/check-out feature was removed this session (both backend and frontend UI); the migration (§8) has been run against dev and these columns no longer exist. |

### The `appointment_status` enum — current live state

The migration in §8 has been run against `salonoxdb_dev`. Confirmed via
`pg_enum` post-migration:
```
booked, confirmed, in_progress, completed, cancelled, no_show, paid, partial, no-show, deleted
```
The 6 old labels (`confirmed`, `in_progress`, `completed`, `no_show`) are still
defined on the type — Postgres has no `ALTER TYPE ... DROP VALUE` — but are
**dead**: no code path writes them anymore. Every row was backfilled to the
new 6-value vocabulary (`booked | paid | partial | cancelled | no-show |
deleted`) as part of the same migration; verified distribution: `booked=179,
paid=661, partial=59, cancelled=19, deleted=6` (924 total, matches
pre-migration row count exactly). The backend and frontend types/queries
(§4) match this live state — no more atomic-unit risk between code and
schema.

---

## 3. The `payments` table — full schema

Separate table, joined into every appointment read. This is the **only**
reliable source for "how much has actually been paid."

| Column | Type |
|---|---|
| `id` | uuid, PK |
| `payment_id` | varchar |
| `invoice_id` | uuid |
| `amount` | numeric |
| `payment_method` | varchar |
| `payment_gateway` | varchar |
| `transaction_id` | varchar |
| `status` | varchar — **own vocabulary**: `pending \| partial \| completed \| failed \| refunded`. Not related to `appointments.status`. |
| `payment_date` | timestamp |
| `created_at` / `updated_at` | timestamp |
| `appointment_id` | uuid — FK, nullable |
| `salon_id` / `client_id` | uuid |
| `gross_amount` / `discount_amount` / `ewallet_used` / `net_amount` | numeric |
| `coupon_code` | varchar |
| `split_details` | jsonb — e.g. `{"Cash": 200, "eWallet": 300}` |
| `paid_at` | timestamptz |
| `notes` | text |
| `paid_amount` | numeric — **the actual amount collected in this transaction** |
| `due_amount` | numeric — the remaining balance *as of that payment* |
| `membership_wallet_used` / `reward_points_value` / `referral_discount_applied` | numeric |
| `tax_breakdown` | jsonb |

A given appointment can have **multiple** payment rows (e.g. a partial deposit,
then a later top-up payment). Always aggregate, never assume one row.

---

## 4. The unified `status` field — what it means, who writes it

As of this session, `appointments.status` is the **single source of truth** for
both lifecycle state and payment state — there is no separate `payment_status`
column (see §6 for why).

### The 6 values (target model — see enum caveat in §2)

| Value | Meaning | Terminal? |
|---|---|---|
| `booked` | Created, nothing paid yet | No |
| `partial` | At least one payment made, balance still owed | No |
| `paid` | Fully paid | **Yes** — no further edits allowed via `update()` |
| `cancelled` | Staff cancelled it | **Yes** |
| `no-show` | Scheduled time passed with nothing paid, never showed | No — resets to `booked` on reschedule |
| `deleted` | Soft-deleted (`deleted_at` also set) | **Yes** |

### State machine

```
booked ──(payment, due>0)──► partial ──(payment, due=0)──► paid  [terminal]
  │
  └──(payment, due=0)──► paid  [terminal]
  │
  ├──(scheduled end time passes, still "booked")──► no-show
  │        └──(rescheduled: time/staff/duration changed)──► booked
  │
  ├──(staff cancels)──► cancelled  [terminal]
  └──(staff deletes)──► deleted   [terminal, soft-delete]
```

### Exactly who writes `status`, and when

| Trigger | File | New value |
|---|---|---|
| Appointment created | `appointments.repository.ts::create()` | `booked` (default) |
| `POST /api/v1/payments` lands, `due_amount > 0` | `payments.service.ts` (~line 329) | `partial` |
| `POST /api/v1/payments` lands, `due_amount = 0` | `payments.service.ts` (~line 329) | `paid` |
| `POST /:id/checkout` (see §5) | `appointments.repository.ts::linkSale()` | `paid` |
| `POST /:id/cancel` | `appointments.service.ts::cancel()` | `cancelled` |
| `DELETE /:id` | `appointments.repository.ts::deleteById()` | `deleted` (+ `deleted_at`) |
| Scheduled end time passes, still `booked` | `appointments.scheduler.ts` (runs every 10 min) | `no-show` |
| A `no-show` booking is rescheduled (time/staff/duration changed via `PATCH`) | `appointments.service.ts::update()` | `booked` |

**Important nuance on the payment trigger**: `payments.service.ts` sets
`status` the instant a payment lands — *before* checkout runs. This means by
the time `POST /:id/checkout` is called (which the frontend calls immediately
after a full payment, see §5), the appointment's status is *already* `'paid'`.
`appointments.service.ts::checkout()`'s guard was specifically written to NOT
throw on this (it checks for a pre-existing linked sale, not `status === 'paid'`,
to detect "already checked out"). If you ever touch that guard, re-read the
comment there first — this is a real bug that was caught and fixed once already.

**Removed transitions** (used to exist, don't anymore): manual `confirm()`,
manual `start()` (→ `in_progress`), manual `no-show` marking, `service-checkin`/
`service-checkout`. All backend routes and frontend thunks for these were
deleted this session — they no longer exist anywhere.

---

## 5. Money fields — how to compute them correctly

**Do not read `appointments.due_amount`.** It is a real column but is never
written by any code path in the entire backend. It is always 0/NULL. This was
confirmed by grepping every INSERT/UPDATE that touches `appointments` and by
live-DB inspection.

**There is no `appointments.payment_status` column.** A migration to add one
exists in git (`migrations/add_payment_status_to_appointments.sql`) but was
**never actually run** against the dev DB (confirmed by live schema
introspection). Any code that assumes this column exists is either dead or
buggy — this was found and fixed in several places this session (e.g.
`SalesSummaryReport.tsx` was permanently showing every row as "Unpaid" because
of this).

### The correct way to get "how much has this client paid / what do they owe"

1. **Paid amount** — `SUM(payments.paid_amount) WHERE appointment_id = X AND status IN ('completed', 'partial')`. This is what `appointments.repository.ts::findById()`/`listBySalonId()` already do (aliased as `paid_amount` in the API response).
2. **Due amount** — **not stored anywhere directly.** Compute as `grandTotal - paidAmount`. The frontend mapper (`bookingMapper.ts`) does exactly this: it ignores `appt.due_amount` (dead column) unless a caller explicitly passes a positive override, and instead computes `Math.max(0, grandTotalVal - payingNow)` whenever `status === 'partial'`.
3. **Payment method / split / tax breakdown** — always take the **most recent** payment row (`ORDER BY created_at DESC LIMIT 1`) — an appointment can have multiple payment rows, only the latest one reflects the current split.

### The checkout flow (this is what actually finalizes a sale + commission)

Two separate things happen, and both must occur for a paid appointment to be
"fully processed":

1. **`POST /api/v1/payments`** — records the payment, sets `appointments.status`
   to `paid`/`partial` (see §4). If `status === 'completed'` in the payment
   payload (payments' own status vocabulary) and it's not a package payment,
   this *also* auto-creates a `sales` row — but does **not** fire commission or
   set `sale_id` on the appointment.
2. **`POST /api/v1/appointments/:id/checkout`** — picks up that pre-existing
   sale (or creates one if none exists), links `sale_id` onto the appointment,
   sets `status = 'paid'`, and fires `commissionCalculationService`. **This is
   the only place commission gets calculated.**

The frontend (`usePayment.ts`) chains these automatically: it posts the
payment, and *only if* `finalDue === 0`, immediately dispatches
`checkoutBookingThunk`. **Package-covered (₹0) payments never call
checkout** (`AppointmentModal.tsx`'s `handleZeroPackagePayment`/
`handleQuickSaleCheckout` package branches only do the Redux-local optimistic
patch) — so package-covered visits reach `status = 'paid'` but **never get a
`sale_id` and never generate commission**. This is a known, currently-accepted
gap, not a bug introduced this session — flagged here so it isn't
rediscovered from scratch.

---

## 6. Backend API surface (live, current)

Base path: `/api/v1/appointments`. Module: `appointments.routes.ts`.

| Method | Path | Handler | Notes |
|---|---|---|---|
| POST | `/` | `create` | `status` defaults to `booked` |
| GET | `/` | `list` | Paginated, filterable by `staff_id`, `status`, `date`/`start_date`/`end_date` |
| GET | `/export` | `exportAppointments` | CSV/Excel |
| GET | `/:id` | `getById` | |
| PATCH | `/:id` | `update` | Reschedule/edit. Blocked on `paid`/`cancelled`/`deleted`. Allowed on `no-show` *only if* the patch changes `scheduled_at`/`staff_id`/`duration_minutes` (auto-resets to `booked`). |
| POST | `/:id/cancel` | `cancel` | |
| DELETE | `/:id` | `delete` | Soft delete |
| POST | `/:id/checkout` | `checkout` | See §5 |

**Removed this session** (routes + controller methods + frontend thunks all
deleted, do not try to call these): `POST /:id/confirm`, `POST /:id/start`,
`POST /:id/no-show`, `POST /:id/service-checkin`, `POST /:id/service-checkout`.

Payments: `POST /api/v1/payments` (separate module, `payments.module`) — see §5.

---

## 7. Frontend data flow

```
schedulerSlice.ts (Redux)          — holds Booking[] in state.scheduler.bookings
        ▲
        │ setBookings(mapped[])
        │
useBookings.ts                     — fetches via fetchBookingsThunk, maps every
        │                             raw item through mapApiBooking, dispatches
        ▼
booking.thunk.ts                   — fetchBookingsThunk/fetchBookingByIdThunk/
        │                             createBookingThunk/updateBookingThunk/
        │                             cancelBookingThunk/checkoutBookingThunk
        ▼
bookingMapper.ts :: mapApiBooking  — THE single mapper (was two duplicate ~250-
                                      line copies before this session; the
                                      duplicate in booking.thunk.ts was deleted
                                      and it now imports this one). Converts
                                      snake_case API shape → camelCase Booking.
```

- **`Booking.status`** (frontend type, `features/bookings/types/booking.types.ts`)
  matches the backend exactly now: `"booked" | "paid" | "partial" | "cancelled" |
  "no-show" | "deleted"`. There is **no** `Booking.paymentStatus` field anymore —
  it was deleted this session (previously a separately-tracked Title-Case
  field that could drift from `status`; this was a real, confirmed source of
  bugs). Anywhere the UI needs a display string, call
  `normalizePaymentStatus(booking.status)` (in `bookingMapper.ts`) — it returns
  `"Paid" | "Partial" | "Unpaid"` for badges/labels.
- **`computeChipStatusClass()`** (`bookingStatusUtils.ts`) is the single place
  that maps `status` → calendar chip color class: `deleted | cancelled |
  confirmed (means paid, green) | partial | no-show | pending (means booked)`.
  Every calendar view (Day/Week/Month/ListWeek) and the booking tooltip use
  this — don't compute chip color anywhere else.
- **Payment completion UI flow**: `usePayment.ts` posts the payment, dispatches
  `patchPaymentStatus` (in `schedulerSlice.ts` — despite the name, this now
  patches `booking.status` directly, not a separate field) for instant optimistic
  UI feedback, then chains `checkoutBookingThunk` if fully paid. See §5.

---

## 8. Migration — run against dev

File: `salon_mgm_backend/migrations/unify_appointment_status.sql` (plain SQL,
matches this folder's existing loose-migration convention — **not** in
`db-migrations/`, which is the node-pg-migrate–tracked folder for a different,
smaller set of recent changes).

**Executed against `salonoxdb_dev` only** — has not been run against staging
or production. Run it there before deploying any of the code changes in this
session to those environments; until then, this remains a deploy blocker for
those environments specifically (code writing `'paid'`/`'partial'`/`'no-show'`/
`'deleted'` will throw a Postgres error on a DB that hasn't run this migration).

What it does:
1. Adds the 4 new enum values via `ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS`.
2. Backfills every existing row's `status`, deriving paid/partial from a live
   join against the `payments` table (there's no `payment_status` column to
   read from — see §6) — this was dry-run simulated against live data before
   being finalized; the row-count totals reconciled exactly (924 rows, no data
   loss: `booked=179, paid=661, partial=59, cancelled=19, deleted=6`).
3. Drops `service_started_at`, `service_ended_at`, and (defensively, `IF
   EXISTS`) `payment_status`.

**Decision made explicitly**: the old, now-unused enum labels (`confirmed`,
`in_progress`, `completed`, `no_show`) are left defined on the type forever
rather than doing a full enum-type recreation (Postgres has no `ALTER TYPE ...
DROP VALUE`) — lower risk, no table lock, a handful of harmless unused labels
is an acceptable tradeoff. Do not "clean this up" later without discussing —
it was a deliberate choice, not an oversight.

---

## 9. What's already been updated to the new model (safe to trust)

As of this session, these all correctly use the unified `status` vocabulary
(post-migration values) and were individually verified + typechecked:

- Backend: `appointments.*`, `payments.service.ts`, `sales.service.ts` (the
  one line that sets an appointment to completed on sale checkout),
  `whatsapp-automation.repository.ts` (reminder queries), `ai-engine/tools/
  appointments.tool.ts` (only the compile-breaking + silently-broken "upcoming"
  filter were fixed — full wording pass explicitly deferred, see §10),
  `salon-dashboard.repository.ts` + `.types.ts`, `reports.repository.ts` +
  `.service.ts`, `clients.repository.ts` + `.controller.ts`.
- Frontend: everything under `features/bookings/`, `middleware/booking/`,
  `store/schedulerSlice.ts`, `middleware/dashboard/dashboard.thunk.ts`,
  `features/dashboard/pages/DashboardPage.tsx`, `features/analytics/reports/
  AppointmentDetailReport.tsx` + `SalesSummaryReport.tsx`, `features/staff/pages/
  StaffAppointmentsPage.tsx` + `StaffPerformancePage.tsx`, `features/clients/
  components/ClientHistoryDetail.tsx`.

## 10. Explicitly NOT done yet (deferred on user instruction)

- `src/modules/ai-engine/tools/*` wording/logic beyond the two must-fix items
  above.
- `src/modules/bot/qa.json` — canned WhatsApp bot answers still describe the
  old 6-status model in plain English.

Do not touch these without being asked — it was an explicit hold, not an
oversight.

## 11. Confirmed dead / do-not-use, full list

- `src/store/calendarSlice.ts`, `src/store/bookingSlice.ts`,
  `src/types/calendar.types.ts`, `src/middleware/calendar/calendar.thunk.ts` —
  **deleted** this session (zero live consumers, confirmed by grep before removal).
- `services/api/endpoints/calendar.endpoints.ts` (`CALENDAR` constant) — still
  exists, still re-exported from `endpoints/index.ts`, but nothing imports it
  anymore. Left in place (not explicitly approved for deletion), but don't use it.
- `appointments.cancelled_at` / `appointments.cancel_reason` — real columns,
  never written. Don't expect data here.
- `appointments.service_id` — real column, but only ever reflects one of
  potentially many services on the `services` JSONB array. Don't trust it for
  multi-service appointments.
- `appointments.due_amount` — see §6. Never written, always 0.
- `appointments.payment_status` — does not exist as a column at all (see §6).
- Frontend `Booking.paymentStatus` — deleted this session, doesn't exist on
  the type anymore. Use `booking.status` + `normalizePaymentStatus()`.
- Manual confirm/start/no-show/check-in/check-out — routes, thunks, and UI all
  removed this session. If you find a reference to any of these that still
  looks "live," it's stale and should be deleted, not resurrected.
