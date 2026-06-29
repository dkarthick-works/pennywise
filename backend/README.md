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
  api/               HTTP handlers, DTOs, pgx<->JSON conversion
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
| GET    | `/api/settings` | income, budgets, currency, theme, templates |
| PUT    | `/api/settings/budgets` | per-section budgets |
| PUT    | `/api/settings/preferences` | income, currency, theme |
| GET    | `/api/templates` | template lists |
| PUT    | `/api/templates/{section}` | replace a section's ordered template list |
| GET    | `/api/transactions?month=YYYY-MM` \| `?year=YYYY` | rows + `settles`/`settled` |
| POST   | `/api/transactions` | create (settlement may include `settles[]`) |
| PATCH  | `/api/transactions/{id}` | partial update; reconciles settlement links |
| DELETE | `/api/transactions/{id}` | delete |
| GET    | `/api/sections/{section}/open-credits?exclude={id}` | settlement picker candidates |
| GET    | `/api/daily-suggestions` | ghost-autocomplete categories |
| GET    | `/api/categories/unmapped` | distinct transaction category strings with no group mapping |
| GET    | `/api/categories/texts?q=&exclude_group_id=` | searchable transaction category strings; optionally excludes labels already in one group |
| GET    | `/api/category-groups` | groups with nested mapping briefs |
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

### Transaction JSON

Mirrors the prototype shape so the frontend port is a pass-through:

```json
{ "id": "uuid", "section": "flexible", "category": "Netflix",
  "amount": 649, "date": "2026-06-06", "kind": "cash",
  "settles": ["credit-id", "…"], "settled": false }
```

`settles` appears on settlement rows; `settled` is the derived flag on credit rows.

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

## Configuration

See `.env.example`. Key vars: `DATABASE_URL`, `JWT_SECRET` (must match Goauth),
`JWT_USER_CLAIM`/`JWT_EMAIL_CLAIM`, `GOAUTH_BASE_URL`, `CORS_ORIGINS`,
`SEED_DEMO_DATA`.
