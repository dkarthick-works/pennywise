# Pennywise

A calm single-user expense tracker that separates **cash**, **credit**, and **settlements** so
incurred spend and cash-out timing never double-count. The SPA is **Pennywise**; the Go service
is historically named **Ledger**.

## Architecture

| Layer | Stack | Documentation |
|-------|-------|---------------|
| Frontend | React + TypeScript + Vite (PWA) | [frontend/README.md](frontend/README.md) |
| Backend | Go (chi) · Postgres 16 · sqlc | [backend/README.md](backend/README.md) |
| Auth | Goauth (JWT, proxied at `/api/auth/*`) | [auth-api-spec.json](auth-api-spec.json) |

Production builds embed the compiled SPA into the Go binary (`Dockerfile` multi-stage build). In
development the frontend runs on Vite and proxies `/api` to the backend.

## Local development

```bash
# 1. Postgres (from backend/)
cd backend && make db-up

# 2. API — copy .env.example → .env, set JWT_SECRET to match Goauth
make run                    # :8080, migrations on boot

# 3. SPA (from frontend/, separate terminal)
cd frontend && npm install && npm run dev   # :5173
```

Sign-up and login require a running **Goauth** instance at `GOAUTH_BASE_URL` (default
`http://localhost:8090`). To exercise the API without Goauth, mint a dev token — see
[backend/README.md § Trying it without Goauth](backend/README.md).

On first authenticated request a new user is auto-provisioned with default settings and
templates; set `SEED_DEMO_DATA=true` to plant the demo dataset (documented in
[backend/README.md](backend/README.md)).

## Production

Copy [`.env.example`](.env.example) to `.env`. Key variables: `DATABASE_URL`, `JWT_SECRET`
(must match Goauth), `GOAUTH_BASE_URL`, `CORS_ORIGINS`.

The server connects to the URL you provide, **creates a `pennywise` database** if it does not
exist, then applies embedded migrations on every boot.

```bash
docker compose up -d --build    # serves on host :8084 → container :8080
```

`docker-compose.yml` expects an external `coolify` network — adjust the `networks` block for
your deployment host.

Health check: `GET /health` (also used by the container `HEALTHCHECK`).

## Repository layout

```
backend/              Go API, migrations, sqlc queries, dev Postgres compose
frontend/             React SPA (Record, Dashboard, Insights, Categories, Settings, Profile)
auth-api-spec.json    Goauth OpenAPI spec (signup, login, refresh, …)
Dockerfile            Multi-stage: npm build → go build (prod tag) → alpine runtime
```

## Recent features (see sub-READMEs for detail)

- **Record page** — default landing route; per-section status filter; daily rows grouped by date
  ([frontend/README.md § Record page](frontend/README.md))
- **Category mapping** — map transaction labels to high-level groups for future dashboards
  ([frontend/README.md § Categories page](frontend/README.md),
  [backend/README.md § Category groups](backend/README.md))
- **Insights** — emergency fund targets from essential spend lookback
  ([backend/README.md § Insights](backend/README.md))
- **PWA** — installable, offline-capable app shell ([frontend/README.md § PWA](frontend/README.md))
