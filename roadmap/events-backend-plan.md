# Events backend implementation plan

Status: proposed implementation plan; product behaviour agreed, technical choices below proposed for review. No implementation is included in this document.

## 1. Scope and invariants

Events is a standalone spending planner. Event writes must never create/update transactions, monthly budgets, settlements, or dashboard financial totals. Suggestions read the existing free-money metric without changing its formula.

- One event has zero or more ordered line items.
- Name required; note optional; target date optional, flexible, editable.
- Status: `planned`, `in_progress`, `completed`, `cancelled`. New events default to planned.
- Suggestions enabled by default; user may disable per event.
- Expected and actual amounts independently nullable: null means not entered; zero means explicitly zero.
- Actual means cumulative cost incurred, including unpaid bills, not payment history.
- Save incomplete events freely. Complete only with at least one item and every actual entered. Expected amounts need not be complete.
- All status transitions are permitted when the resulting event satisfies completion requirements. No automatic transitions from dates or amounts.
- Completed/cancelled events remain editable. A completed event cannot be made empty or have missing actuals unless explicitly reopened in the same operation or beforehand.
- Actual amounts can exceed expectations. No variance fields or calculations in V1.
- Soft deletion of events; no restore/trash API in V1.
- Duplication copies planning data but resets actuals, date, status, IDs, and timestamps.
- No reservations, allocations, snoozing, explanations, transaction linking, recurring events, attachments, import/export, or frontend implementation.

## 2. Repository integration

Use existing Go/Chi + pgx + PostgreSQL + SQLC architecture, not a new service/framework.

Relevant existing sources:
- `backend/internal/api/server.go`: authenticated routes, user identity, JSON helpers.
- `backend/internal/api/dashboard.go`: monthly budget loading and free-money calculation.
- `backend/db/queries/transactions.sql`: `SumDashboardMonthly` source accounting.
- `backend/internal/api/dashboard_test.go`: preserves existing metric, including positive free money with negative balance.
- `backend/internal/api/monthly_budgets.go`: monetary bounds and validation precedent.
- `backend/db/migrations/0010_chits.up.sql`: standalone parent/child ledger precedent.
- `backend/internal/api/categories_test.go`: real PostgreSQL API test setup.
- `frontend/src/lib/dates.ts`: current month uses browser-local calendar, not UTC.

## 3. Storage

Next available migration currently `0012_events.up.sql` / `.down.sql`; recheck numbering before implementation.

### events

| Column | Definition |
| --- | --- |
| id | UUID PK, generated |
| user_id | UUID FK users, ON DELETE CASCADE |
| name | TEXT, nonempty trimmed value |
| note | TEXT NOT NULL DEFAULT '' |
| target_date | nullable DATE |
| status | TEXT NOT NULL DEFAULT 'planned', CHECK allowed values |
| suggestions_enabled | BOOLEAN NOT NULL DEFAULT true |
| version | BIGINT NOT NULL DEFAULT 1, positive; optimistic concurrency token |
| created_at / updated_at | TIMESTAMPTZ NOT NULL |
| deleted_at | nullable TIMESTAMPTZ |

Indexes: active user listing `(user_id, created_at DESC, id)` WHERE deleted_at IS NULL; candidate lookup `(user_id, target_date, id)` WHERE deleted_at IS NULL AND status = 'planned' AND suggestions_enabled.

### event_items

| Column | Definition |
| --- | --- |
| id | UUID PK, generated |
| event_id | UUID FK events, ON DELETE CASCADE |
| name | TEXT, nonempty trimmed value |
| expected_cost | nullable NUMERIC(14,2), nonnegative when present |
| actual_cost | nullable NUMERIC(14,2), nonnegative when present |
| position | INTEGER NOT NULL, nonnegative |
| created_at / updated_at | TIMESTAMPTZ NOT NULL |

Unique `(event_id, position)` constraint, deferrable for atomic reorder operations. Event deletion sets only the parent's deleted_at, retaining its items. Removing a line item during ordinary editing physically removes that item; item history/restore is outside V1. Confirm separately if soft deletion is desired for individual removed items too.

Do not persist totals or completeness flags. Aggregate with exact PostgreSQL NUMERIC or integer minor units in Go. Validate precision before storage so PostgreSQL cannot silently round extra decimal places. Preserve JSON numeric conventions at response boundaries; do not use binary-float arithmetic for new event sums/comparisons. The existing dashboard calculation remains unchanged; normalize its resulting financial amount consistently to minor units for event comparisons.

## 4. API contract

Prefer aggregate writes: one atomic event save includes the ordered item list. This avoids partially saved forms and handles reopening plus clearing actuals in one operation. Separate per-item endpoints are not necessary for V1.

| Method/path | Behaviour |
| --- | --- |
| GET /api/events?status=planned&limit=50&offset=0 | Active events; optional validated status; default newest first, ID tie-breaker; bounded pagination |
| POST /api/events | Create event with optional items; returns full event, 201 |
| GET /api/events/{id} | Active owned event with ordered items and summary, 200 |
| PUT /api/events/{id} | Replace editable aggregate using required version; returns updated event, 200 |
| DELETE /api/events/{id} | Soft delete; require current version via If-Match; 204 |
| POST /api/events/{id}/duplicate | Duplicate active owned event; optional new name/date, 201 |
| GET /api/events/suggestions?month=YYYY-MM&timezone=Asia/Kolkata | Current-month-only matching event summaries, 200 |

Register static suggestions route clearly alongside event routes. Every endpoint is inside the existing authenticated group.

### Create / update

Create defaults: note '', target_date null, status planned, suggestions_enabled true, items []. Creation may explicitly supply another valid status; completed requires the same invariant.

PUT requires name, note, target_date (including explicit null), status, suggestions_enabled, version, and items. This is deliberate full replacement, not PATCH. Each item requires name, expected_cost, actual_cost; costs may explicitly be null. For creation costs may be omitted and default to null. Array order defines position.

On update, existing items carry IDs; new items omit IDs. Omitted old items are removed. Reject duplicate IDs, unknown IDs, and IDs belonging to another event; never move items across parents. Retain IDs and creation timestamps for existing items.

Suggested guardrails: trimmed names 1–200 characters, note <= 5,000 characters, <= 500 items, request body <= 1 MiB, list limit default 50/max 100. Costs 0 through 999999999999.99, at most two decimal places; reject negative/non-finite/out-of-range values. Strict date validation and UUID validation; reject unknown JSON fields. These are technical limits, not new product features.

### Response summary

Full event responses include metadata, version, items, and:

```json
{
  "summary": {
    "item_count": 2,
    "expected_total": 8000,
    "actual_total": 2000,
    "missing_expected_count": 0,
    "missing_actual_count": 1,
    "budget_complete": true,
    "actuals_complete": false,
    "can_complete": false
  }
}
```

Totals always sum entered values only, yielding zero if none are entered. Completeness flags prevent interpreting a partial total as a finished estimate. Both completeness flags require at least one item; can_complete equals actuals_complete. No variance or savings fields. List and suggestion responses use the same summary without embedding items; detail/create/update/duplicate include items. No frontend arithmetic is required.

List envelope: `{ "events": [...], "limit": 50, "offset": 0, "has_more": false }`; use limit+1 fetching. No unbounded list or N+1 item queries.

Errors follow existing `{ "error": "..." }` convention: 400 invalid input/invariant, 401 unauthenticated, 404 missing/other-user/deleted event, 409 stale version, 413 oversized body, 500 database/internal failure. Use consistent non-disclosing item-ID errors. For completed events, report which completion rule failed.

DELETE checks ownership/active state/version, increments version and updates timestamps/deleted_at atomically. A repeated deletion returns 404. Other event-specific routes also return 404 after deletion.

## 5. Suggestions and clock boundary

### Proposed timezone contract

There is no persisted user timezone today. Accept an optional validated IANA `timezone` query parameter, default UTC, and document that browser clients should pass `Intl.DateTimeFormat().resolvedOptions().timeZone`. Derive current month server-side from an injectable clock in that timezone. This is a calendar-context input, never a client-supplied financial value. Ensure timezone data is available in the deployment (Go time/tzdata embedding if needed).

Require valid `month=YYYY-MM`. If it differs from computed current month (historical OR future), return 200 with no suggestions, without loading that month's finances. Invalid timezone/month returns 400. Return current_month and effective timezone so clients can understand the boundary. This is a proposed technical choice requiring review, not an existing app capability.

### Algorithm

1. Validate requested calendar context; enforce current-month-only.
2. Read current month's free money using the exact same backend calculation as the dashboard.
3. If free money <= 0, return no suggestions.
4. Candidate must belong to user, be active, planned, and suggestions_enabled.
5. target_date is null OR target_date < first day of next month. Old dates remain eligible.
6. At least one item, no missing expected costs.
7. expected_total <= free_money, inclusive. Fully estimated zero-cost events qualify only when free money is positive.
8. Sort dated first, earliest date first, then created_at/id for stable ties; undated follow.
9. Evaluate independently. Do not subtract earlier matches or actual incurred amounts from the allowance.

Response: `{ "month": "...", "current_month": "...", "timezone": "...", "free_money": 10000, "events": [...] }`. For non-current requests, free_money is null, events empty. Use the same bounded limit/offset/has_more approach as listing after filtering.

Extract dashboard data loading into a shared helper usable by the dashboard and suggestions. Keep `dashboardMonthlyToDTO` formula and all existing fields intact, including negative remaining budgets. No safer metric, clamp, outstanding-credit adjustment, caching, or new financial policy in this feature.

For consistent suggestion results, read finance inputs and candidates in one read-only repeatable-read transaction, passing SQLC queries bound to that transaction to the shared loader. This is still advisory data that can change after the response, not an allocation guarantee.

## 6. Lifecycle, duplication, and concurrency

All event mutations run in a database transaction, locking the active owned parent row before evaluating current state. PUT and DELETE compare supplied version under that lock, returning 409 on stale writes. All item changes and parent timestamp/version updates commit together.

Validate completion on the resulting aggregate, not just on status-change requests. This prevents removing the last item or clearing actuals while leaving the parent completed. User can submit status planned and null actuals together. Never reset status silently.

Duplication locks the source parent while reading items so concurrent updates/deletion cannot produce a mixed snapshot. Copy names, note, item order, expected values (including null), and suggestion preference. Default new name to source name + ' (copy)', with documented truncation to name limit; optional name overrides it. New target_date defaults null unless supplied. Always planned, all actuals null, new IDs/timestamps/version 1. Source is unchanged. Duplicate completed or cancelled events is allowed; deleted/other-user sources return 404.

Get detail must read parent/items consistently (single query or read-only snapshot transaction). Child access always requires an active owned parent. Foreign keys alone do not establish user ownership.

## 7. Implementation sequence and files

1. Schema migration + rollback; `backend/db/queries/events.sql`; SQLC generation into `backend/internal/db/` (do not hand-edit generated code).
2. Event input/DTO/summary validation helpers, `backend/internal/api/events.go` and focused helper files as needed.
3. CRUD/aggregate updates, lifecycle validation, optimistic concurrency, soft deletion.
4. Duplication endpoint and atomic snapshot behaviour.
5. Shared dashboard loader refactor with existing regression tests unchanged.
6. `backend/internal/api/event_suggestions.go`: timezone/clock handling, current-month gate, shared financial reader, candidate selection.
7. Wire routes in `backend/internal/api/server.go`; injectable clock initialized in constructor, no wall-clock-dependent tests.
8. Document endpoint contracts and standalone-ledger warning in `backend/README.md`; add Bruno requests matching repository collection conventions.
9. Tests and verification below; run `graphify update .` after code changes. On shipping the user-facing feature, follow local app-story instructions; this planning document does not constitute shipping.

## 8. Test matrix

### Unit tests (always run)
- Blank/long names, note/item/body limits, malformed JSON, bad IDs/dates/status.
- Null vs zero, fractional precision, maximum amounts, invalid/negative amounts.
- Empty/partial/complete summaries; known totals; actual over budget permitted.
- Completion with zero items or missing actual rejected; zero actual accepted; missing expected allowed.
- Every explicit status transition and edits preserving completion invariants.
- Timezone validation; fixed-clock month/year rollover, timezone boundary differences, February/leap year; no implicit server-local clock.

### PostgreSQL API integration tests
- CRUD defaults, list filters/pagination/order, item reorder/insert/remove with stable IDs.
- Atomic rollback on invalid item/failed write; no partial event mutation.
- User isolation for events, item IDs, duplication, suggestions, and deletion.
- Soft-deleted rows/items retained in DB; all normal reads/mutations excluded.
- Duplicate defaults/overrides and reset semantics, including incomplete source budgets.
- Suggestions: every lifecycle/toggle/date/completeness combination; exact budget match; over-budget exclusion; free money positive/zero/negative; zero-cost event gate.
- Two independently affordable events both returned even if sum exceeds allowance.
- Historical/future request empty; current request uses existing metric exactly, even where current metric looks counterintuitive.
- Partially entered actual costs do not change suggestion expected-total comparison or status.
- Stale updates/deletes return 409; synchronized concurrent writes cannot lose edits or violate completion. Existing test setup truncates users, so do not parallelize DB fixture tests.
- Event mutations leave transaction counts/content and dashboard financial DTO unchanged.
- Existing dashboard tests remain unchanged and pass after loader extraction.

### Verification commands

From backend: `make generate`, `go build ./...`, `go test ./...`, `go vet ./...`.

Run integration suite with `PENNYWISE_TEST_DATABASE_URL` pointing to a dedicated disposable database; existing helper migrates and TRUNCATES users CASCADE. Never use a development/production DB containing data to retain. An unset variable skips integration tests and must be reported as skipped, not verified. Exercise migration up/down/up only on disposable DB, then regenerate SQLC and check generated diff stability. Run race-enabled tests where supported.

## 9. Review checkpoints before coding

Product scope is settled. Review these proposed technical defaults with the plan:
- Whole-event PUT with stable item IDs rather than separate item endpoints.
- Optimistic version checks on update/delete.
- Request timezone with UTC fallback (browser-local timezone supplied by eventual frontend).
- Event soft deletion retains children; individually removed items are not history-tracked.
- Proposed payload limits and pagination.

Implement only after plan approval. No free-money formula changes or frontend work are authorized by this plan.
