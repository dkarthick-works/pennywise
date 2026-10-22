# Pennywise

A personal expense tracker that separates **cash**, **credit**, and **settlements** so
incurred spend and cash-out timing never double-count. The SPA is **Pennywise**; the Go service
is historically named **Ledger**.

## Architecture

Start with the [application overview and backend diagram](docs/architecture.md);
the canonical [Mermaid source](docs/architecture.mmd) is versioned alongside it.
For runtime defaults, database bootstrap, tests and troubleshooting, see
[configuration and safe local operation](docs/configuration.md).

| Layer | Stack | Documentation |
|-------|-------|---------------|
| Frontend | React + TypeScript + Vite (PWA) | [frontend/README.md](frontend/README.md) |
| Backend | Go (chi) · Postgres 16 · sqlc | [backend/README.md](backend/README.md) |
| Auth | Goauth (JWT, proxied at `/api/auth/*`) | [auth-api-spec.json](auth-api-spec.json) |

Production builds embed the compiled SPA into the Go binary (`Dockerfile` multi-stage build). In
development the frontend runs on Vite and proxies `/api` to the backend.

## Local development

Prerequisites: Go 1.26.3 or a compatible newer toolchain, Node 22.13+ on the
22.x line, npm, Make and Docker Compose. Use valid local database credentials in
`backend/.env` (the example contains a placeholder password). Do not use an
existing personal/production database to try these commands.

Terminal 1, **starting at the repository root**:

```bash
cd backend
cp .env.example .env
# Edit .env: use the dev Compose database credentials and a JWT_SECRET matching Goauth.
make db-up
make run                    # :8080, applies migrations before serving
```

Terminal 2, **starting at the repository root**:

```bash
cd frontend
npm ci
npm run dev                 # :5173; /api proxies to :8080
```

Sign-up and login require a running **Goauth** instance at `GOAUTH_BASE_URL` (default
`http://localhost:8090`). To exercise the API without Goauth, mint a dev token — see
[backend/README.md § Trying it without Goauth](backend/README.md).

On first authenticated request, the backend ensures the user, default settings
and General Reserve exist. It does not insert template rows or demo transactions;
`SEED_DEMO_DATA` is not a supported server setting. Configure templates through
the app. See [database and provisioning details](docs/configuration.md).

## Production

Copy [`.env.example`](.env.example) to `.env`. Key variables: `DATABASE_URL`, `JWT_SECRET`
(must match Goauth), `GOAUTH_BASE_URL`, `CORS_ORIGINS`.

The server always uses the **`pennywise` database**. When the supplied URL targets
another existing database, it bootstraps `pennywise` there if needed (requiring
creation privileges), then switches to it. A URL already targeting `pennywise`
skips creation and requires that database to exist. Pending embedded migrations
run on every boot; inspect them and back up data before deploying.

```bash
docker compose up -d --build    # serves on host :8084 → container :8080
```

`docker-compose.yml` expects an external `coolify` network — adjust the `networks` block for
your deployment host.

Health check: `GET /health` (also used by the container `HEALTHCHECK`).

## Repository layout

```
backend/              Go API, migrations, sqlc queries, dev Postgres compose
frontend/             React SPA (Record, Dashboard, Search, Events, Reserves, Lent, Chits, …)
docs/                 Architecture overview/diagram and configuration guide
auth-api-spec.json    Goauth OpenAPI spec (signup, login, refresh, …)
Dockerfile            Multi-stage: npm build → go build (prod tag) → alpine runtime
```

## Recent features (see sub-READMEs for detail)

- **AI transaction parsing** — natural-language previews on Quick add (`/record/entry`);
  `POST /api/transactions/parse` (OpenRouter-backed, never writes)
  ([frontend/README.md § AI quick add](frontend/README.md),
  [backend/README.md § AI transaction previews](backend/README.md))
- **Category group spend comparison** — 3/6/12-month history, statistics, and drill-down
  from dashboard group cards
  ([frontend/README.md § Dashboard page](frontend/README.md),
  [backend/README.md § Group spend history](backend/README.md))
- **Transaction search** — fuzzy name lookup across all months with cursor pagination
  ([frontend/README.md § Transaction search](frontend/README.md),
  [backend/README.md § Universal transaction search](backend/README.md))
- **Record page** — default landing route; per-section status filter; daily rows grouped by date with per-day spent totals;
  Essential/Flexible **Add row** via local draft (no empty-category API post); post-save focus back to
  name with cleared amount on Daily/Income/Quick add; transaction-name autocomplete on Daily/Income
  quick-add; **Copy last month** on Income/Essential/Flexible; **Quick add** cross-section entry at
  `/record/entry`; **Dashboard** shortcut on the tile grid
  ([frontend/README.md § Record page](frontend/README.md))
- **Dashboard daily spend chart** — Daily-section incurred spend by calendar day with month total and
  average-per-day header (client-side rollups)
  ([frontend/README.md § Dashboard page](frontend/README.md))
- **Events** — planning with item estimates/actuals and optimistic concurrency;
  explicit conversion can create a linked normal transaction
  ([frontend workflow](frontend/README.md#events), [backend API](backend/README.md#events-apievents))
- **Reserves** — entry-derived balances and operation history; reserve-only
  operations stay separate, while income-transfer/funded-expense operations create
  protected normal transactions ([architecture boundaries](docs/architecture.md#financial-boundaries))
- **Lent tracker** — standalone ledger for money lent to others with repayment history
  ([frontend/README.md § Lent page](frontend/README.md),
  [backend/README.md § Lents](backend/README.md))
- **CSV import/export** — download transactions and bulk-import with review
  ([frontend/README.md § Import / Export page](frontend/README.md),
  [backend/README.md § CSV export](backend/README.md))
- **Category mapping** — map transaction labels to high-level groups for dashboard rollups
  ([frontend/README.md § Categories page](frontend/README.md),
  [backend/README.md § Category groups](backend/README.md))
- **Credit card usage** — calendar-month and statement-cycle spend with optional per-period threshold
  ([frontend/README.md § Dashboard page](frontend/README.md),
  [frontend/README.md § Settings page](frontend/README.md))
- **Chit funds** — isolated chit-fund subscriptions with installment tracking
  ([frontend/README.md § Chit funds page](frontend/README.md),
  [backend/README.md § Chits](backend/README.md))
- **Chit JSON transfer** — bounded full-account or per-chit export and
  append-only import with nested installments
  ([frontend/README.md § Import / Export page](frontend/README.md),
  [backend/README.md § Chit JSON transfer](backend/README.md))
- **Insights** — emergency fund targets from essential spend lookback
  ([backend/README.md § Insights](backend/README.md))
- **PWA** — installable, precached app shell with resilient multi-tab sessions and safe
  cache headers on deploy; API access and financial writes still require a network
  ([frontend/README.md § PWA](frontend/README.md))
