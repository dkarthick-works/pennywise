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
| `/record` | Record Expense | **Default landing page** after login (`/` redirects here) |
| `/dashboard` | Dashboard | Monthly/yearly spend; category-group rollups |
| `/dashboard/groups/:groupId` | Category group drilldown | Transactions for one mapped group in the shared month |
| `/insights` | Insights | Emergency fund targets (from `GET /api/insights`) |
| `/categories` | Map Categories | Assign transaction labels to high-level groups |
| `/export` | Import / Export | CSV export and import with review table |
| `/settings` | Settings | Budgets, templates, preferences |
| `/profile` | Profile | Display name and email |
| `/login` | Auth | Sign up / log in (password field has show/hide toggle) |

Unknown authenticated paths fall back to `/record`.

## Record page

The primary workflow surface. Three section tiles — **Essential**, **Flexible**,
and **Daily / Running** — each with an editable transaction table for the
selected month.

### Month navigation

The header shows the open month with **previous / next chevrons** and a dropdown
to jump to any month. Month state is shared with Dashboard via `App.tsx`. Closing
a month is a cosmetic bookkeeping flag — editing still works.

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
user-defined **groups** for dashboard rollups. Transaction rows are not modified.
Mapping changes invalidate the `group-spend` query used on Dashboard.

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

## Dashboard page

Nav item: **Dashboard** (`/dashboard`). Toggle **Monthly** vs **Yearly** at the top.

### Monthly view

- **Cash Flow** and **Monthly Cost** hero cards use `GET /api/dashboard/monthly`
  (payment-date cash out vs incurred spend).
- **Section cards** (Essential / Flexible / Daily) are frontend-computed from month
  transactions with budget bars from settings.
- **Category Groups** (when the user has mapped groups): bar cards from
  `GET /api/dashboard/group-spend`. A filter dropdown selects which groups to show;
  groups can overlap when one label maps to multiple groups. Click a card to open
  `/dashboard/groups/:groupId`. The section scrolls into view when linked as
  `/dashboard#category-groups`.

### Yearly view

Loads all transactions for the selected year. Shows income/spend totals, a monthly
bar chart, section donut, and top categories — all client-side.

## Category group drilldown

Route: `/dashboard/groups/:groupId`. Lists transactions for one group in the
shared month (`getCategoryGroupTransactions`). **Dashboard** link returns to
`/dashboard#category-groups`.

## Import / Export page

Nav item: **Import / Export** (`/export`).

### Export

Pick an inclusive date range (max **6 months**). Downloads a Pennywise CSV via
`GET /api/transactions/export`. Settlement rows are excluded; income is included.
Default range is the current calendar month.

### Import

Upload a CSV with columns `date`, `section`, `category`, `amount`, `kind`
(Pennywise export format works; `id` and `currency` are ignored). Parsing and
validation live in `src/lib/import.ts` (max **2000** rows). Invalid rows are
highlighted in an editable review table; import is blocked until all rows pass.
`POST /api/transactions/import` on confirm. Settlement rows are rejected.
Category mappings are **not** applied — map new labels on the Categories page
after import. Successful import invalidates transaction, dashboard, and
category caches for affected months/sections (`src/lib/monthCaches.ts`).

## API client

- `src/api/client.ts` — axios instance, Bearer token from `sessionStorage`,
  silent refresh on 401 via `/api/auth/refresh`.
- `src/api/ledger.ts` — typed wrappers for all ledger endpoints.
- `src/api/auth.ts` — signup, login, logout.

## PWA

`vite-plugin-pwa` precaches the app shell. Client-side routes fall back to
`index.html`; `/api/*` is excluded from the service worker navigate fallback.
