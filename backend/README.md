# Ledger — Backend

Go API + Postgres for **Pennywise** (Ledger), a calm single-user expense tracker.
Authentication is handled
by a separate **Goauth** service (`../auth-api-spec.json`); this backend consumes
it — it never stores passwords.

## Stack

- **Go** (chi router) · **pgx/v5** pool · **sqlc** type-safe queries · **golang-migrate** (embedded migrations)
- **Postgres 16** (via Docker Compose)
- JWT (HS256) access tokens verified locally with a shared secret

## The data model (why it exists)

Every transaction has **one date** and a **kind**, modelling two timings of money
without double-counting:

| kind         | meaning                                          | Incurred view | Cash-Out view |
|--------------|--------------------------------------------------|:-------------:|:-------------:|
| `cash`       | incurred & paid same day                         | ✓             | ✓             |
| `credit`     | incurred now, not paid yet (open liability)      | ✓             | —             |
| `settlement` | a later cash outflow clearing ≥1 earlier credits | —             | ✓             |

- **Incurred** = `cash + credit` by date · **Cash-Out** = `cash + settlement` by date.
- A `settlement` links one-or-more `credit` rows of the **same section** via the
  `settlement_links` join table. A linked credit is reported as `settled`.
- Sections: `essential`, `flexible`, `daily`. Budgets are per-section, user-global.

### Category groups (mapping layer)

Transaction rows store free-text `category` labels. **Category groups** are a separate
metadata layer that maps those labels to high-level group names (e.g. `"Netflix"` →
`"Streaming"`). Mappings do **not** rewrite transaction rows — they exist for future
aggregations (dashboard rollups, etc.).

| table | purpose |
|-------|---------|
| `category_groups` | named bucket per user (`name` + `normalized_name`, unique per user) |
| `category_mappings` | links a transaction category string to a group (`raw_category` preserved, `normalized_category` for matching); one label can belong to multiple groups |

**Normalization** (Go: `internal/category/normalize.go`, SQL: same rules in queries):
trim whitespace, collapse runs of spaces to one, lowercase. Two labels that normalize
to the same string are treated as one mapping slot per user.

**Unmapped** = distinct non-blank `transactions.category` values with no matching
`category_mappings.normalized_category`. Creating a mapping requires the normalized
category to already appear in the user's transactions.

Empty groups are allowed and stay around until the user deletes the group.

## Layout

```
db/
  migrations/        golang-migrate up/down SQL (embedded into the binary)
  queries/           sqlc source queries
  embed.go           //go:embed of the migrations
internal/
  config/            env-driven configuration
  auth/              JWT verify middleware + Goauth reverse proxy
  database/          pgx pool + migration runner
  db/                sqlc-GENERATED code (do not edit)
  seed/              default templates + demo dataset (ported from data.jsx)
  api/               HTTP handlers, DTOs, pgx<->JSON conversion (incl. lents, import/export)
  category/          label normalization for category groups
  insights/          emergency fund calculation (pure logic, no I/O)
cmd/
  server/            the API server
  seed/              seed an existing user id with templates/demo data
  token/             mint a dev HS256 token (test without Goauth)
```

## Running

```bash
cp .env.example .env          # adjust JWT_SECRET to match Goauth
make db-up                    # start Postgres (docker compose)
make run                      # applies migrations on boot, serves :8080
```

Regenerate query code after editing `db/queries/*.sql`:

```bash
make generate                 # sqlc generate
```

### Trying it without Goauth

```bash
TOK=$(go run ./cmd/token -user 11111111-1111-1111-1111-111111111111 -email me@ledger.app)
curl -s localhost:8080/api/me           -H "Authorization: Bearer $TOK"   # provisions + seeds demo
curl -s "localhost:8080/api/transactions?month=2026-06" -H "Authorization: Bearer $TOK"
```

A brand-new user is auto-provisioned on first authenticated request: default
settings + template rows are created, and (when `SEED_DEMO_DATA=true`) the
June/May 2026 demo dataset is planted.

## API

All routes require `Authorization: Bearer <access_token>` except `/health` and
`/api/auth/*`. Auth is **proxied** to Goauth (cookies relayed) — the browser
only ever talks to this origin.

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/health` | server + db health |
| *      | `/api/auth/*` | proxied to Goauth (signup, login, refresh, logout, me, …) |
| GET    | `/api/me` · `/api/profile` | current user / profile |
| PUT    | `/api/profile` | update name + email |
| GET    | `/api/settings` | income, budgets, currency, theme, templates, credit statement day, credit spending threshold |
| PUT    | `/api/settings/budgets` | per-section budgets |
| PUT    | `/api/settings/preferences` | income, currency, theme |
| PUT    | `/api/settings/credit-billing-cycle` | set/clear credit statement closing day (`1..31` or `null`) |
| PUT    | `/api/settings/credit-spending-threshold` | set/clear per-period credit spend warning (`> 0`, max 2 decimals, or `null`) |
| GET    | `/api/templates` | template lists |
| PUT    | `/api/templates/{section}` | replace a section's ordered template list |
| GET    | `/api/transactions?month=YYYY-MM` \| `?year=YYYY` | rows + `settles`/`settled` |
| POST   | `/api/transactions` | create (settlement may include `settles[]`) |
| PATCH  | `/api/transactions/{id}` | partial update; reconciles settlement links |
| DELETE | `/api/transactions/{id}` | delete |
| GET    | `/api/transactions/export?from=YYYY-MM-DD&to=YYYY-MM-DD` | download CSV (max 6-month range; settlements omitted) |
| POST   | `/api/transactions/import` | bulk-create from validated rows (max 2000; settlements rejected) |
| GET    | `/api/transaction-names/suggestions?section=&q=&limit=` | ranked, typo-tolerant transaction-name autocomplete |
| GET    | `/api/sections/{section}/open-credits?exclude={id}` | settlement picker candidates |
| GET    | `/api/daily-suggestions` | ghost-autocomplete categories |
| GET    | `/api/dashboard/monthly?month=YYYY-MM` | dashboard hero-card totals |
| GET    | `/api/dashboard/group-spend?month=YYYY-MM` | per-group spend for dashboard category cards |
| GET    | `/api/dashboard/credit-usage?month=YYYY-MM` | calendar-month + statement-cycle credit spend |
| GET    | `/api/dashboard/credit-transactions?month=YYYY-MM&view=calendar\|billing` | credit rows for one window |
| GET    | `/api/categories/unmapped` | distinct transaction category strings with no group mapping |
| GET    | `/api/categories/texts?q=&exclude_group_id=` | searchable transaction category strings; optionally excludes labels already in one group |
| GET    | `/api/category-groups` | groups with nested mapping briefs |
| GET    | `/api/category-groups/{id}/transactions?month=YYYY-MM` | transactions mapped to one group in a month |
| POST   | `/api/category-groups` | create an empty group (`name`) |
| PATCH  | `/api/category-groups/{id}` | rename group |
| DELETE | `/api/category-groups/{id}` | delete group and all its mappings |
| GET    | `/api/category-mappings` | flat list with `group_name` |
| POST   | `/api/category-mappings` | map label to existing `group_id` **or** new `group_name` (not both) |
| DELETE | `/api/category-mappings/{id}` | remove mapping from one group |
| GET    | `/api/insights` | emergency fund targets from essential spend |
| GET    | `/api/months/{month}` | `{closed, seeded}` |
| PUT    | `/api/months/{month}/closed` | toggle the cosmetic closed flag |
| POST   | `/api/months/{month}/open` | clone templates into a fresh month, return its rows |
| GET    | `/api/lents?status=open\|settled\|all` | list money lent to others (default `all`) |
| POST   | `/api/lents` | create a lent |
| GET    | `/api/lents/export` | download all lents and repayments as a versioned JSON archive |
| POST   | `/api/lents/import` | atomically add lents and repayments from a JSON archive |
| GET    | `/api/lents/{id}` | lent detail with nested `repayments` |
| PATCH  | `/api/lents/{id}` | update lent fields |
| DELETE | `/api/lents/{id}` | delete lent and all repayments |
| GET    | `/api/lents/{id}/repayments` | list repayments for one lent |
| POST   | `/api/lents/{id}/repayments` | record a repayment instalment |
| PATCH  | `/api/lents/{id}/repayments/{rid}` | update a repayment |
| DELETE | `/api/lents/{id}/repayments/{rid}` | delete a repayment |
| GET    | `/api/chits` | list chit-fund schemes with installment summaries |
| POST   | `/api/chits` | create a chit |
| GET    | `/api/chits/{id}` | chit detail with nested installments |
| PATCH  | `/api/chits/{id}` | update chit fields |
| DELETE | `/api/chits/{id}` | delete chit and all installments |
| POST   | `/api/chits/{id}/installments` | record an installment payment |
| PATCH  | `/api/chits/{id}/installments/{installmentId}` | update an installment |
| DELETE | `/api/chits/{id}/installments/{installmentId}` | delete an installment |
| GET    | `/api/chits/export[?chit_id={uuid}]` | download all chits, or one chit, as JSON |
| POST   | `/api/chits/import` | atomically append chits and installments from JSON |

### Transaction JSON

Mirrors the prototype shape so the frontend port is a pass-through:

```json
{ "id": "uuid", "section": "flexible", "category": "Netflix",
  "amount": 649, "date": "2026-06-06", "kind": "cash",
  "settles": ["credit-id", "…"], "settled": false }
```

`settles` appears on settlement rows (omitted when empty). `settled` is always
present: `true` when a credit row is linked from a settlement, otherwise `false`
(including non-credit rows).

### Transaction-name autocomplete

`GET /api/transaction-names/suggestions` searches the authenticated user's
learned transaction-name history. `section` is required and accepts
`essential`, `flexible`, `daily`, or `income`; `q` is optional; and `limit`
defaults to 10 with a maximum of 20.

```http
GET /api/transaction-names/suggestions?section=daily&q=cof&limit=10
```

```json
{
  "items": [
    { "name": "Coffee" },
    { "name": "Coffee — Starbucks" }
  ]
}
```

An empty query returns the most-used, most-recent names. One- and two-character
queries use prefix matching; longer queries add substring and PostgreSQL trigram
similarity matching, so minor misspellings can still return useful results.

The history is maintained atomically by database triggers whenever a normal
transaction is inserted or its category/section changes. Blank, over-200-character,
and settlement labels are ignored. Learned names remain available after the
source transaction is renamed or deleted. Results are always scoped by both
the authenticated user and requested section.

### Dashboard (`GET /api/dashboard/monthly?month=YYYY-MM`)

Returns the monthly hero-card totals for the selected month. Section cards,
donut charts, budget bars, and the yearly dashboard remain frontend-computed for
now.

**What counts:**

- `income`: all rows where `section = 'income'`.
- `cash_flow`: expense rows (`essential`, `flexible`, `daily`) where `kind` is
  `cash` or `settlement`.
- `monthly_cost`: expense rows where `kind` is `cash` or `credit`.
- `outstanding_credits_*`: expense `credit` rows incurred in the selected month
  that have no `settlement_links` row.
- `net_saved`, `monthly_difference`, and `savings_rate` are computed in the Go
  handler from the raw sums. `savings_rate` is `0` when income is `0`.

Response shape:

```json
{
  "month": "2026-06",
  "income": 85000,
  "cash_flow": 62000,
  "monthly_cost": 71000,
  "net_saved": 23000,
  "savings_rate": 27.06,
  "monthly_difference": 14000,
  "outstanding_credits_count": 2,
  "outstanding_credits_total": 9000
}
```

### Group spend (`GET /api/dashboard/group-spend?month=YYYY-MM`)

Returns one row per category group for the user, sorted by group name. Spend is
the sum of transaction `amount` in the month whose normalized category label
matches any mapping in that group. All transaction kinds are included (no
`kind` filter). Groups with no matching transactions return `total: 0`.

Response shape — JSON array:

```json
[
  { "group_id": "uuid", "group_name": "Streaming", "total": 3245.0 }
]
```

Handlers: `internal/api/group_spend.go`; query `SumSpendByGroupsForMonth` in
`db/queries/category_groups.sql`.

### Credit usage (`GET /api/dashboard/credit-usage?month=YYYY-MM`)

Returns expense **credit** spend for the selected month in two windows:

- `calendar_month`: the first through last day of `month`.
- `billing_cycle`: the statement cycle that **closes** in `month`, or `null`
  when no statement day is configured.

Both windows are derived solely from `month` (never from today's date), so
historical dashboard navigation is deterministic. The metric counts rows where
`section IN ('essential','flexible','daily')` and `kind = 'credit'`; settlement
state is irrelevant (settled and unsettled credits both count).

**Statement cycle semantics.** `credit_statement_day` (`1..31`, see
`/api/settings/credit-billing-cycle`) is the inclusive **closing** day. For a
closing day of `15`, the July 2026 cycle is `2026-06-16` through `2026-07-15`.
Days beyond a month's length clamp to that month's final day, applied
independently to the selected month and the previous month (so `31` closes on
Feb 28/29). See `statementCycleRange` in `internal/api/billing_cycle.go`.

All `from`/`to` values are **inclusive display dates**; SQL always queries the
half-open range `[from, to + 1 day)` (`SumCreditUsage`). Because grouping uses
the recorded `txn_date` (not a bank posting date), results near the closing day
may differ from a bank statement — the UI labels totals "by recorded
transaction date".

Response shape (configured):

```json
{
  "month": "2026-07",
  "calendar_month": { "from": "2026-07-01", "to": "2026-07-31", "total": 22251, "count": 10 },
  "billing_cycle":  { "statement_day": 15, "from": "2026-06-16", "to": "2026-07-15", "total": 18400, "count": 8 }
}
```

When unconfigured, `billing_cycle` is explicit `null` (never omitted) and
`calendar_month` is always present. The configured statement day is surfaced via
`billing_cycle.statement_day` and through `GET /api/settings`.

### Credit transactions (`GET /api/dashboard/credit-transactions?month=YYYY-MM&view=`)

Authoritative drill-down rows for one window. `view` is `calendar` (default) or
`billing`. The `billing` view returns `400` when no statement day is configured.
Ranges are derived with the same helpers as the summary endpoint, and the
response `total`/`count` reuse `SumCreditUsage` so detail metadata always
reconciles with the summary bucket.

```json
{
  "month": "2026-07", "view": "billing",
  "from": "2026-06-16", "to": "2026-07-15",
  "total": 18400, "count": 8, "transactions": []
}
```

Handlers: `internal/api/credit_usage.go`; range math in
`internal/api/billing_cycle.go`; queries `SumCreditUsage` and
`ListCreditTransactionsByDateRange` in `db/queries/transactions.sql`.

### Credit spending threshold (`PUT /api/settings/credit-spending-threshold`)

Optional per-period warning amount stored in `user_settings.credit_spending_threshold`
(`NUMERIC(14,2)`, nullable; migration `0009_credit_spending_threshold`). The
Dashboard CC Usage card compares it independently to **statement-cycle** and
**calendar-month** credit totals — it is a soft purchase warning, not a credit
limit.

Request body — property **required**; explicit JSON `null` clears:

```json
{ "credit_spending_threshold": 25000 }
```

**Validation:** positive decimal with at most two fractional places; no exponent
notation; max `999999999999.99`. Zero, negatives, strings, and missing property
return `400` before PostgreSQL is touched. Returns the full settings DTO on
success (same shape as `GET /api/settings`).

Also surfaced through `GET /api/settings` as `credit_spending_threshold: number | null`.

Handler: `handleUpdateCreditSpendingThreshold` in `internal/api/settings.go`.

### Category group transactions (`GET /api/category-groups/{id}/transactions?month=YYYY-MM`)

Returns the group's name, month, total spend, and matching transactions for the
month (newest first). Same category-matching rules as group spend. Returns
`404` when the group id does not belong to the user.

```json
{
  "group_id": "uuid",
  "group_name": "Streaming",
  "month": "2026-06",
  "total": 3245.0,
  "transactions": [ { "id": "…", "section": "flexible", "category": "Netflix", "amount": 649, "date": "2026-06-06", "kind": "credit", "settled": false } ]
}
```

Handler: `internal/api/group_transactions.go`; queries
`ListTransactionsByGroupForMonth` and `SumTransactionsByGroupForMonth`.

### Category groups

Handlers live in `internal/api/categories.go`; queries in `db/queries/category_groups.sql`.
Migration: `0004_category_groups`.

**Create mapping** — `POST /api/category-mappings`:

```json
{ "raw_category": "Netflix", "group_id": "uuid-of-streaming" }
```

or create a new group inline:

```json
{ "raw_category": "Swiggy", "group_name": "Food delivery" }
```

Returns `409 Conflict` if the normalized category is already in that group or the
group name collides. Returns `400` if the category text does not exist in any
transaction.

**List unmapped** — `GET /api/categories/unmapped` returns a JSON array of strings,
sorted alphabetically.

### Insights (`GET /api/insights`)

Derives emergency fund targets from **essential** section spend. Used by the
Insights page in the SPA.

**Lookback:** the last 3 calendar months including the current month (e.g. in
June 2026: Apr, May, Jun).

**What counts as spend:** per-month sum of `amount` where `section = 'essential'`
and `kind <> 'settlement'` — i.e. `cash` and open `credit` rows. Settlements
are excluded because they represent cash-out timing, not incurred essential
cost. Months with no rows return `0`.

**Seed amount:** the highest monthly total in the lookback window. If two months
tie, the most recent month wins.

**Tiers:** Bare (3× seed), Comfort (6×), Luxury (12×). The UI highlights
Comfort as the primary target.

Response shape:

```json
{
  "seed_amount": 42000,
  "seed_month": "2026-05",
  "lookback_months": ["2026-04", "2026-05", "2026-06"],
  "monthly_totals": [
    { "month": "2026-04", "amount": 38000 },
    { "month": "2026-05", "amount": 42000 },
    { "month": "2026-06", "amount": 39500 }
  ],
  "emergency_fund": {
    "bare":    { "multiplier": 3,  "amount": 126000 },
    "comfort": { "multiplier": 6,  "amount": 252000 },
    "luxury":  { "multiplier": 12, "amount": 504000 }
  }
}
```

Logic lives in `internal/insights/emergency_fund.go`; the handler aggregates
via `SumEssentialSpendByMonths` in `db/queries/transactions.sql`.

### CSV export (`GET /api/transactions/export?from=&to=`)

Downloads a Pennywise-compatible CSV for the inclusive date range. Both
`from` and `to` must be `YYYY-MM-DD`; `from` must be on or before `to`, and
the span must not exceed **6 calendar months** (same rule as the SPA export
form). Settlement rows are omitted from the file. Returns `404` when the range
contains no exportable rows (including settlement-only ranges).

Columns: `id`, `date`, `section`, `category`, `amount`, `currency`, `kind`.
The `Content-Disposition` header carries the filename
(`pennywise-transactions-{from}_{to}.csv`).

### CSV import (`POST /api/transactions/import`)

Bulk-creates normal transaction rows in one database transaction. Request
body:

```json
{
  "rows": [
    { "date": "2026-06-01", "section": "daily", "category": "Coffee", "amount": 120, "kind": "cash" }
  ]
}
```

**Validation rules:**

- At least one row, at most **2000** rows.
- `kind` must be `cash` or `credit` — **settlement rows are rejected**.
- `income` rows must be `cash`.
- `amount` must be `>= 0`; `category` is required after trim.
- Per-row field errors return `400` with `{ "error": "validation failed", "rows": [ { "index": 0, "fields": { … } } ] }`.

On success returns `201` with `{ "imported": N, "months": ["YYYY-MM", …] }`.
Each touched month is marked seeded (same as opening a month manually).
Settlement links are not created by import — record settlements in the Record
page after import.

Handlers: `internal/api/import.go`; export logic in `internal/api/transactions.go`.

### Lents (`/api/lents`)

Tracks money lent to other people in a **standalone ledger** — deliberately
isolated from `transactions`. Lent rows never appear on the Dashboard, Record
page, CSV export, category suggestions, or insights calculations.

| table | purpose |
|-------|---------|
| `lents` | one loan: counterparty, principal `amount`, `lent_on`, optional `due_on`, note |
| `lent_repayments` | partial or full repayments against a lent |

`open` vs `settled` is **derived** from `outstanding = amount - SUM(repayments)`
and is never stored, so status cannot drift from repayment rows.

**Create / update body:**

```json
{ "counterparty": "Ravi", "amount": 5000, "lent_on": "2026-06-01", "due_on": "2026-07-01", "note": "" }
```

`counterparty` is required; `amount` must be `> 0`; dates are `YYYY-MM-DD`;
`due_on` cannot be before `lent_on`.

**List** — `GET /api/lents?status=open|settled|all` (default `all`). Summary
rows omit nested repayments.

**Detail** — `GET /api/lents/{id}` includes `repayments` sorted by date.
Returns `404` when the id does not belong to the user.

**Repayments** — `POST /api/lents/{id}/repayments` with
`{ "amount": 2000, "repaid_on": "2026-06-15", "note": "" }`. A repayment
cannot exceed the current outstanding balance (`400` when it would
over-repay). Updates use the same shape; when editing, the outstanding cap
excludes the row being edited so a no-op edit does not false-trigger
over-repayment.

**Delete** — removing a lent cascades to its repayments.

### Lent archive transfer

`GET /api/lents/export` downloads all user-owned lents, including settled
lents and nested repayments, as `pennywise-lents-v1.json`.
`POST /api/lents/import` accepts the same versioned JSON archive and returns
`{ "imported_lents": N, "imported_repayments": N }`.

The archive shape is:

```json
{
  "type": "pennywise-lents",
  "version": 1,
  "exported_at": "2026-08-16T00:00:00Z",
  "lents": [
    {
      "source_id": "uuid",
      "counterparty": "Ravi",
      "amount": "5000.00",
      "lent_on": "2026-06-01",
      "due_on": null,
      "note": "",
      "repayments": [
        {
          "source_id": "uuid",
          "amount": "2000.00",
          "repaid_on": "2026-06-15",
          "note": ""
        }
      ]
    }
  ]
}
```

All archive properties are required; `due_on` may be a date or `null`, and
notes and arrays may be empty. Amounts are positive decimal strings with at
most two fractional digits. Imports generate new database IDs, remap nested
repayments, reject over-repayment, and run atomically. Re-importing the same
archive is intentionally additive and creates another set of records.
Archives are limited to 25 MiB, 10,000 lents, 50,000 repayments, and 500
repayments per lent.

Handlers: `internal/api/lents.go` and `internal/api/lent_transfer.go`; queries in `db/queries/lents.sql`;
migration `0006_lents`.

### Chits (`/api/chits`)

Tracks chit-fund subscriptions in a **standalone ledger** — installments do
not become `transactions` rows and are excluded from Dashboard, Insights, cash
flow, CSV export, and category suggestions.

| table | purpose |
|-------|---------|
| `chits` | scheme metadata: name, organizer, `chit_value`, `expected_monthly`, `total_installments` (1–360), `start_month` (`YYYY-MM-01`) |
| `chit_installments` | individual payments: `paid_on`, `amount`, optional `note` (≤500 chars) |

**Status** is derived: `active` while `installment_count < total_installments`,
else `completed`. Completed chits reject new installments (`409`).

**Create / update body:**

```json
{
  "name": "Office chit",
  "organizer": "Ravi",
  "chit_value": 100000,
  "expected_monthly": 5000,
  "total_installments": 20,
  "start_month": "2026-01-01"
}
```

`name` and `organizer` are required (≤120 chars). Money fields must be `> 0`,
≤ `999999999999.99`, with at most two decimal places. `total_installments` is
1–360 and cannot be lowered below the existing installment count.

After the **first installment**, `start_month`, `expected_monthly`, and
`total_installments` are locked (`409` on change). `name`, `organizer`, and
`chit_value` remain editable.

**Installments** — `POST /api/chits/{id}/installments` with
`{ "paid_on": "2026-06-01", "amount": 5000, "note": "" }`. `paid_on` is
`YYYY-MM-DD`.

Handlers: `internal/api/chits.go`; queries in `db/queries/chits.sql`;
migration `0010_chits`.

### Chit JSON transfer

`GET /api/chits/export` returns a deterministic, versioned archive:

```json
{
  "format": "pennywise-chits",
  "version": 1,
  "chits": [
    {
      "name": "Office chit",
      "organizer": "Ravi",
      "chit_value": 100000.00,
      "expected_monthly": 5000.00,
      "total_installments": 20,
      "start_month": "2026-01-01",
      "installments": [
        { "paid_on": "2026-06-01", "amount": 5000.00, "note": "" }
      ]
    }
  ]
}
```

The archive omits IDs, user ownership, timestamps, status, counts, and totals.
`POST /api/chits/import` validates the complete archive before opening a write
transaction, creates fresh IDs, and returns
`{ "imported_chits": N, "imported_installments": N }` with `201`. Re-importing
the same file intentionally appends duplicates; existing records are never
updated or deleted.

The inclusive transfer limits are 5 MiB of raw UTF-8 JSON, 500 chits, 10,000
installments, 1 MiB of stored UTF-8 names/organizers/notes, and 360
installments per chit. Money is encoded as JSON numbers with at most two
decimal places; exponent notation, non-finite values, over-precision, and
out-of-range amounts are rejected. Limit violations return `413` with
`{ "error": "import exceeds transfer limits" }` for imports. Full export
violations return `413` and direct the user to export individual chits with
`?chit_id={uuid}`. Empty full exports are valid; empty imports return `400`.

Handlers: `internal/api/chit_transfer.go`; transfer queries are in
`db/queries/chits.sql`.

## Configuration

See `.env.example`. Key vars: `DATABASE_URL`, `JWT_SECRET` (must match Goauth),
`JWT_USER_CLAIM`/`JWT_EMAIL_CLAIM`, `GOAUTH_BASE_URL`, `CORS_ORIGINS`,
`SEED_DEMO_DATA`.

### Password reset

Requesting a reset link (`/forgot-password` in the frontend, proxied through
`/api/auth/forgot-password`) is the only part of this flow Pennywise is
involved in. Goauth's password-reset email links directly to Goauth's own
domain (e.g. `sign.deeka.work/auth/reset-password?token=...`) and Goauth
serves and handles the entire reset form there — the browser never comes back
to Pennywise for that step, so no token ever reaches this backend or its
logs. Note: per Goauth's own integration guide, it has no rate limiting on
forgot/reset-password; that's Goauth's operational concern, not this repo's.
