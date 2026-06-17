# Pennywise — Frontend

React + TypeScript + Vite SPA for **Pennywise** (Ledger). Talks to the Go API
in `../backend/`; auth is proxied through that backend to Goauth.

## Running locally

Start the API first (see `../backend/README.md`), then:

```bash
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:8080` (see `vite.config.ts`). Cookies
from Goauth refresh are rewritten for `localhost` during dev.

Production builds are embedded into the Go binary (`Dockerfile` multi-stage build).

## Routes

| Path | Page | Notes |
|------|------|-------|
| `/record` | Record & Expense | **Default landing page** after login (`/` redirects here) |
| `/dashboard` | Dashboard | Month/year charts and summaries |
| `/insights` | Insights | Emergency fund targets (from `GET /api/insights`) |
| `/settings` | Settings | Budgets, templates, preferences |
| `/profile` | Profile | Display name and email |
| `/login` | Auth | Sign up / log in (password field has show/hide toggle) |

Unknown authenticated paths fall back to `/record`.

## Record page

The primary workflow surface. Three section tiles — **Essential**, **Flexible**,
and **Daily / Running** — each with an editable transaction table for the
selected month.

### Status filter

Every section table has a **Status** column with an optional header filter
(`StatusFilter.tsx`). Click the funnel icon to multi-select display statuses:

| Display status | When it applies |
|----------------|-----------------|
| `cash` | `kind = cash` |
| `credit` | `kind = credit`, not yet settled |
| `settled` | `kind = credit`, linked from a settlement |
| `settlement` | `kind = settlement` |

An empty selection shows all rows. The filter button appears only when the
section has two or more distinct statuses. Filtering is client-side only — it
does not change API queries.

### Daily date grouping

The **Daily** tile sorts rows by date descending (then by id), then inserts
date header rows (`date-group-hdr`) whenever the date changes. Each header shows
the formatted date and entry count. The quick-add row stays pinned at the top.

## API client

- `src/api/client.ts` — axios instance, Bearer token from `sessionStorage`,
  silent refresh on 401 via `/api/auth/refresh`.
- `src/api/ledger.ts` — typed wrappers for all ledger endpoints.
- `src/api/auth.ts` — signup, login, logout.

## PWA

`vite-plugin-pwa` precaches the app shell. Client-side routes fall back to
`index.html`; `/api/*` is excluded from the service worker navigate fallback.
