# Ledger — Backend

Go API + Postgres for **Ledger**, a calm single-user expense tracker. This is the
real backend for the design prototype in `../project/`. Authentication is handled
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

## Configuration

See `.env.example`. Key vars: `DATABASE_URL`, `JWT_SECRET` (must match Goauth),
`JWT_USER_CLAIM`/`JWT_EMAIL_CLAIM`, `GOAUTH_BASE_URL`, `CORS_ORIGINS`,
`SEED_DEMO_DATA`.
