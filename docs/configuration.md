# Configuration and safe local operation

The server calls `godotenv.Load()` in its current directory, then reads process
environment values. Existing environment variables take precedence over `.env`.
Run backend commands from `backend/`; the root `.env` instead feeds the production
Compose service. See [`config.go`](../backend/internal/config/config.go) and
[`cmd/server/main.go`](../backend/cmd/server/main.go).

## Environment variables

Defaults below are code defaults, not deployment recommendations.

| Variable | Default / behavior | Requirement |
| --- | --- | --- |
| `PORT` | `8080` | Optional; bind port and container health-check target |
| `DATABASE_URL` | Local `ledger` user/database on `localhost:5432`, SSL disabled; see `config.go` | Set to valid credentials; database bootstrap described below |
| `JWT_SECRET` | Insecure development fallback in `config.go` | Explicit shared Goauth signing secret for a real deployment |
| `JWT_USER_CLAIM` | `sub` (falls back to `sub` if configured claim absent) | Must contain a UUID string |
| `JWT_EMAIL_CLAIM` | `email` | Optional identity metadata |
| `GOAUTH_BASE_URL` | `http://localhost:8090` | Running Goauth needed for browser login/signup/refresh |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed browser origins |
| `SENTRY_DSN` | Empty | Optional backend error reporting; failed initialization is logged |
| `OPENROUTER_API_KEY` | Empty | Set with `OPENROUTER_MODEL`, or leave both empty |
| `OPENROUTER_MODEL` | Empty | Exactly one of key/model set aborts startup |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Optional parser endpoint override |
| `OPENROUTER_TIMEOUT` | `15s` | Positive Go duration; invalid/nonpositive values fall back to default |
| `OPENROUTER_SITE_URL` | Empty | Optional provider attribution |
| `OPENROUTER_APP_NAME` | `Pennywise` | Optional provider attribution |

`SEED_DEMO_DATA` is not read by the server. First authenticated access creates
user/settings/General Reserve only. Templates are configured by the user; demo
seeding is a separate explicit command. Never seed an existing personal or
production database as part of setup or a documentation check.

## Database bootstrap and migrations

[`internal/database/database.go`](../backend/internal/database/database.go)
always uses an application database named `pennywise`. If the URL targets a
different existing database, bootstrap connects there, checks whether `pennywise`
exists, creates it when needed and rewrites the URL path to `/pennywise` for
migrations and the pool. The role needs database-creation privileges only when
creation is necessary. If the supplied URL already targets `/pennywise`, creation
is skipped: provision that database first.

Every server start applies pending embedded up migrations before listening.
There is no automatic down migration. Back up data and inspect migrations before
deployment; migration `0015` adds a stored normalized-name column and ordinary
indexes, which can rewrite/lock a populated transactions table. Trigram search
also requires the `pg_trgm` extension installed by migrations. Test migrations
only on disposable databases, not on a shared server selected by a familiar URL.

The development Compose file creates `ledger` as a bootstrap database and uses a
persistent named volume. `make db-down` stops Compose without deleting that data.
The production Compose file does not include Postgres or Goauth and requires an
existing external `coolify` network. Host port `8084` maps to container `8080`;
keep `PORT=8080` unless you also deliberately adapt the deployment mapping.

## Commands and troubleshooting

From `backend/`, `make build` runs `go build ./...` and `make test` runs
`go test ./...`. Go must satisfy `go 1.26.3` in `go.mod`; `make generate` additionally
needs `sqlc`. Database integration tests are opt-in with
`PENNYWISE_TEST_DATABASE_URL` and can truncate user data. The OpenRouter smoke test
is opt-in with `PENNYWISE_OPENROUTER_SMOKE=1` and calls a real provider; ordinary
unit tests do not require either opt-in.

From `frontend/`, use Node 22.13+ on the 22.x line (the production Docker build uses
Node 22), `npm ci`, `npm run build`, and `npm test`. The lockfile is the resolved
dependency source. Newer Node releases are not automatically equivalent: Node
26.7 can expose a missing `localStorage` in the API-client unit test; the same
suite passes on Node 22.22.0. Browser E2E tests are a separate
`npm run test:e2e` command and need Playwright browsers; inspect
[`playwright.config.ts`](../frontend/playwright.config.ts) before running them.

For a local API token, the token command reads environment variables but does
**not** load `.env`. Export the same `JWT_SECRET` and claim settings used by the
running server before invoking it; keep tokens in variables, not committed files:

```bash
# From backend/, with JWT_SECRET already exported to match the local server.
TOK=$(go run ./cmd/token -user 11111111-1111-1111-1111-111111111111 -email dev@example.com)
curl --fail http://localhost:8080/api/me -H "Authorization: Bearer ${TOK}"
```

A `401` usually means the token is missing, expired, has a non-UUID subject or was
signed using different settings. A startup database error may mean the bootstrap
URL/credentials are invalid, `pennywise` is absent when directly targeted, the
role cannot create a database, or a migration failed. `/health` checks database
connectivity, not login or AI-provider readiness. For refresh-cookie attribute
requirements, see the [backend deployment gate](../backend/README.md#production-refresh-cookie-gate).
