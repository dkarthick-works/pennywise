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
| `/dashboard` | Dashboard | Month/year charts, hero cards, category-group spend |
| `/dashboard/credits` | Credit transactions | Drill-down from the Credit Card Usage hero card |
| `/dashboard/groups/:groupId` | Category group | Drill-down from a category-group spend card |
| `/insights` | Insights | Emergency fund targets (from `GET /api/insights`) |
| `/categories` | Map Categories | Assign transaction labels to high-level groups |
| `/settings` | Settings | Budgets, templates, preferences |
| `/profile` | Profile | Display name and email |
| `/login` | Auth | Sign up / log in (password field has show/hide toggle) |

Unknown authenticated paths fall back to `/record`.

## Dashboard page

Monthly and yearly views of spend. The global month selector in the shell drives
both the main dashboard and the drill-down routes below.

### Monthly hero cards

Three summary cards at the top. **Monthly Cost** and **Cash Flow** use
`GET /api/dashboard/monthly`; **Credit Card Usage** is computed client-side from
the month's transactions.

| Card | What it measures | Basis |
|------|------------------|-------|
| Monthly Cost | Incurred spend (`cash` + `credit`) | Transaction date |
| Cash Flow | Cash that moved (`cash` + `settlement`) | Payment date |
| Credit Card Usage | Expense-section `credit` rows | Transaction date |

The **Credit Card Usage** card shows total charged and transaction count for
`essential`, `flexible`, and `daily` rows where `kind = credit`. Settled credits
are included — this is incurred spend, not open liability. Click the card (or
press Enter/Space when focused) to open `/dashboard/credits`.

### Category group spend

When the user has category groups, a **Category groups** section lists monthly
spend per group from `GET /api/dashboard/group-spend`. Groups can overlap when
the same label is mapped to more than one group. A filter dropdown selects which
groups to show; each card links to `/dashboard/groups/:groupId`. The section has
`id="category-groups"` so `/dashboard#category-groups` scrolls here.

### Drill-down pages

Both drill-down routes reuse `TransactionListTable` (`src/components/dashboard/TransactionListTable.tsx`).

| Route | Data source | Notes |
|-------|-------------|-------|
| `/dashboard/credits` | `GET /api/transactions?month=` filtered by `creditExpenseTransactions()` | Kind column hidden |
| `/dashboard/groups/:groupId` | `GET /api/category-groups/{id}/transactions?month=` | Shows date, category, section, kind, amount |

`creditExpenseTransactions()` in `src/lib/txns.ts` keeps rows where
`kind === "credit"` and the section is an expense section (`essential`, `flexible`,
`daily`).

### Yearly view

Client-side rollups from `GET /api/transactions?year=`: total income/spend,
per-month bars, top categories, and section split donut.

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

## Categories page

Nav item: **Map Categories** (`/categories`). Maps free-text transaction labels to
user-defined **groups** for dashboard spend rollups. Transaction rows are not modified.

### Tabs

| Tab | Purpose |
|-----|---------|
| **Needs mapping** | Lists unmapped category strings from `GET /api/categories/unmapped`. Each row can be assigned to an existing group (pill buttons) or a new group name. |
| **Groups** | Browse groups, rename or delete a group, remove individual mappings, and search transaction text to add labels to a group. |

A search box filters both tabs (category text and group names).

### API wrappers

Category endpoints are in `src/api/ledger.ts` (`getUnmappedCategories`, `getCategoryGroups`,
`getTransactionCategoryTexts`, `createCategoryMapping`, `createCategoryGroup`,
`updateCategoryGroup`, `deleteCategoryGroup`, `deleteCategoryMapping`).
React Query keys are prefixed with `["categories", …]`; mutations invalidate the whole tree.

### Constraints (from the API)

- A mapping can only be created for category text that already appears in your transactions.
- Label matching is case- and whitespace-insensitive (backend normalizes before compare).
- A category label can belong to multiple groups, but not twice in the same group.
- Empty groups stay visible until the user deletes them.
- `POST /api/category-mappings` accepts `group_id` **or** `group_name`, not both.

## API client

- `src/api/client.ts` — axios instance, Bearer token from `sessionStorage`,
  silent refresh on 401 via `/api/auth/refresh`.
- `src/api/ledger.ts` — typed wrappers for all ledger endpoints.
- `src/api/auth.ts` — signup, login, logout.

## PWA

`vite-plugin-pwa` precaches the app shell. Client-side routes fall back to
`index.html`; `/api/*` is excluded from the service worker navigate fallback.
