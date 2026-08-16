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
| `/record/entry` | Quick add | Cross-section draft-row entry (section/kind cycle chips, sticky date, visit session log) |
| `/dashboard` | Dashboard | Month/year charts, hero cards, category-group spend |
| `/dashboard/credits?month=&view=calendar\|billing` | Credit transactions | Drill-down from the Credit Card Usage hero card; month + view carried in the URL |
| `/dashboard/groups/:groupId` | Category group | Drill-down from a category-group spend card |
| `/lents` | Lent | Track money lent to others (open/settled filter, create form) |
| `/lents/:id` | Lent detail | Edit/delete lent, record and manage repayments |
| `/chits` | Chit funds | List chit schemes with active/completed status |
| `/chits/new` | Create chit | New chit-fund scheme form |
| `/chits/:id` | Chit detail | View installments, record payments, export this chit as JSON |
| `/chits/:id/edit` | Edit chit | Update scheme fields |
| `/chits/:id/installments/new` | Add installment | Record a chit payment |
| `/insights` | Insights | Emergency fund targets (from `GET /api/insights`) |
| `/categories` | Map Categories | Assign transaction labels to high-level groups |
| `/export` | Import / Export | CSV export (date range) and import with review table |
| `/settings` | Settings | Budgets, templates, credit card controls |
| `/profile` | Profile | Display name and email |
| `/login` | Auth | Sign up / log in (password field has show/hide toggle) |
| `/forgot-password` | Forgot password | Request a reset link by email (always shows the same success copy — anti-enumeration). The emailed link goes straight to Goauth's own domain, not back into Pennywise — the reset form itself is served entirely by Goauth. |

Unknown authenticated paths fall back to `/record`.

## Dashboard page

Monthly and yearly views of spend. The global month selector in the shell drives
both the main dashboard and the drill-down routes below.

### Monthly hero cards

Three summary cards at the top. **Monthly Cost** and **Cash Flow** use
`GET /api/dashboard/monthly`; **Credit Card Usage** uses
`GET /api/dashboard/credit-usage` (backend-authoritative — no client-side
aggregation).

| Card | What it measures | Basis |
|------|------------------|-------|
| Monthly Cost | Incurred spend (`cash` + `credit`) | Transaction date |
| Cash Flow | Cash that moved (`cash` + `settlement`) | Payment date |
| Credit Card Usage | Expense-section `credit` rows | Recorded transaction date |

The **Credit Card Usage** card shows two totals from the summary API: the
**statement cycle** that closes in the selected month and the **calendar month**.
Both count `essential`/`flexible`/`daily` rows where `kind = credit`; settled
credits are included (incurred spend, not open liability). Each block is a real
`<button>` opening the matching drill-down view. The card renders explicit
loading, error/retry, and unconfigured states and never falls back to `₹0`.

The statement cycle only appears once a **statement closing day** is set in
Settings (`/settings#credit-billing-cycle`); until then the card shows a
"Set your statement date" CTA in place of the cycle total. The closing day is
the inclusive last day of the cycle — day `15` makes July's cycle Jun 16 – Jul 15,
with days 29–31 clamped to a month's last day. `src/lib/billingCycle.ts` mirrors
the backend math for the Settings live preview only; the API response remains
authoritative for card totals.

When a **credit spending threshold** is set in Settings
(`/settings#credit-spending-threshold`), each period block shows a compact
progress bar with "within" / "over threshold" text. The same rupee limit applies
independently to statement-cycle and calendar-month totals.

### Daily spend by day

Below the hero cards, a **Daily Spend by Day** bar chart shows **Daily**
section incurred spend (`cash` + `credit`) for each calendar day in the
selected month. Data comes from the same month transaction fetch as the Record
page (`GET /api/transactions?month=`); the chart is computed client-side in
`src/lib/txns.ts` (`dailySpendByDay`, `dailySpendAverage`) and rendered with
`DayBars` in `src/components/charts/Charts.tsx`.

Every day in the month appears on the axis — days with no matching rows show
₹0. Future-dated transactions in the selected month are included. The card
header shows the month total and an average rupees-per-day figure: for the
**current** month the average is through today ("Avg · …/day · so far"); for
past or future months it uses the full month. Loading, error/retry, and empty
month states mirror the hero cards.

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
| `/dashboard/credits?month=&view=` | `GET /api/dashboard/credit-transactions?month=&view=` | Kind column hidden; month + view read from the URL |
| `/dashboard/groups/:groupId` | `GET /api/category-groups/{id}/transactions?month=` | Shows date, category, section, kind, amount |

The credit drill-down reads `month` and `view` (`calendar`/`billing`) from the
query string, canonicalizing invalid values, so refreshes and direct links are
stable. A segmented control switches views, Back returns to
`/dashboard?month=YYYY-MM`, and the billing view shows a setup CTA when no
statement day is configured. Rows come straight from the API (no local calendar
filtering).

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

### Quick-add defaults

On **Daily** and **Income** tiles, the quick-add date defaults to the **latest
date already in that table** (`defaultDraftDate` in `src/lib/dates.ts`), not
today's calendar day. When the table is empty it falls back to today within the
selected month. After each add the draft date is preserved so back-filling a run
of same-day entries does not reset to today.

### Transaction-name autocomplete

**Daily** and **Income** quick-add rows (and Daily row edits) use
`CategoryInput` with ranked suggestions from
`GET /api/transaction-names/suggestions`. Type at least **2 characters** to
fetch; use ↑/↓ and Enter to pick. Queries are debounced (200 ms) and scoped
per section. Suggestions learn from past category labels via database triggers
and survive renames/deletes of the source transaction.

React Query keys live in `src/lib/transactionNameSuggestions.ts`; mutations
invalidate the affected section via `invalidateTransactionNameSuggestions` in
`src/lib/monthCaches.ts`.

### Copy last month

**Income**, **Essential**, and **Flexible** tiles expose a **Copy last month**
button (`CopyLastMonthButton.tsx`). It loads the previous month's transactions,
builds a plan (`src/lib/copyLastMonth.ts`), and asks for confirmation with exact
insert/fill counts before writing.

**Eligible source rows:** same section; positive amount; non-empty category;
`settlement` kind skipped. Income copies `cash` only; Essential/Flexible copy
`cash` or `credit`.

**Fill vs insert:** Essential/Flexible first try to fill existing **zero-value
cash** rows in the current month (trimmed, case-sensitive category match; each
zero row used once). Unmatched rows are bulk-inserted via
`POST /api/transactions/import`; fills use `PATCH /api/transactions/{id}`.
Income has no template rows, so it always inserts.

Dates are shifted into the target month. Existing non-zero rows are never
replaced. The operation is not fully atomic — if inserts succeed but some fills
fail, the UI warns against retrying (which would duplicate inserts).

### Quick add

The **Quick add** tile on the Record grid opens `/record/entry` — a single-form
workflow for rapid cross-section entry without opening each section tile.

**Flow:** type name → amount → Enter (or click +). Section and kind are chosen
via cycle chips before each add; income always posts as `cash`. Keyboard:
**Alt+S** cycles section (Essential → Flexible → Daily → Income), **Alt+K**
cycles kind (Cash → Credit → Settlement). Bare S/K are intentionally ignored so
typing in the name field is safe.

**Date** defaults to the latest date already present in the open month (same
`defaultDraftDate` helper as Daily/Income quick-add). It stays sticky across
adds until the user edits the date field; month navigation always keeps the
date inside the selected month.

**This session** lists every row created during the visit (newest first). Each
session row supports inline edit and delete via the same `PATCH`/`DELETE`
transaction APIs as the Record tables. Session state is visit-local — leaving
the page clears the log, but saved rows remain in the ledger.

Implementation: `src/pages/RecordEntryPage.tsx`; month bootstrap via
`openMonth` (`POST /api/months/{month}/open`).

## Settings page

Nav item: **Settings** (`/settings`).

| Section | Anchor | Notes |
|---------|--------|-------|
| Budgets | — | Per-section budget amounts (autosave) |
| Templates | — | Ordered category lists per section |
| Preferences | — | Income, currency, theme |
| Credit card controls | `#credit-billing-cycle` | Statement closing day + spending threshold |

**Credit card controls** groups two explicit Save/Clear settings (never
autosave):

- **Statement closing day** — `PUT /api/settings/credit-billing-cycle` with
  `credit_statement_day` (`1..31`) or `null`. Live cycle preview uses
  `src/lib/billingCycle.ts`; successful saves invalidate all credit-usage caches
  (`invalidateCreditCaches`).
- **Credit spending threshold** — `PUT /api/settings/credit-spending-threshold`
  with a positive rupee amount (up to two decimals) or `null` to disable. The
  dashboard CC Usage card reads the saved value from `GET /api/settings`.

## Lent page

Nav item: **Lent** (`/lents`). A separate ledger for money lent to other people
— it does **not** feed Dashboard, Record, CSV export, or category suggestions.

| Route | Purpose |
|-------|---------|
| `/lents` | List with open/settled/all filter, outstanding summary, inline create form |
| `/lents/:id` | Edit lent fields, delete lent, list/add/edit/delete repayments |

List defaults to **open** loans. The detail page hides the repayment form when
the lent is settled. API wrappers are in `src/api/lents.ts`; React Query keys
are prefixed with `["lents", …]`.

## Chit funds page

Nav item: **Chit funds** (`/chits`). Tracks chit-fund subscriptions separately
from the main ledger — installments do **not** feed Dashboard, Record, CSV
export, or insights.

| Route | Purpose |
|-------|---------|
| `/chits` | List schemes with active/completed status and total paid |
| `/chits/new` | Create a new chit |
| `/chits/:id` | View installments, add payments, link to edit |
| `/chits/:id/edit` | Update name, organizer, chit value; structural fields locked after first installment |
| `/chits/:id/installments/new` | Record an installment payment |

API wrappers are in `src/api/chits.ts`; helpers in `src/lib/chits.ts`. React
Query keys are prefixed with `["chits", …]`.

## Import / Export page

Nav item: **Import / Export** (`/export`).

**Export** — pick an inclusive `from`/`to` date range (defaults to the current
shell month; max **6 months**). Downloads via `GET /api/transactions/export`.
Settlement rows are omitted from the CSV.

**Import** — upload a Pennywise export CSV. The client parses and validates
rows (`src/lib/import.ts`, max **2000** rows), shows an editable review table,
then posts to `POST /api/transactions/import`. Settlement rows are rejected;
income must be `cash`. Category mappings are **not** applied automatically —
map new labels on the Categories page after import. Successful import
invalidates transaction and suggestion caches for the returned months.

**Lent transfer** — the page also exports all lent records, including settled
lents and nested repayments, as a versioned `pennywise-lents-v1.json` archive.
Upload a JSON archive to preview its lent and repayment counts before importing.
Imports are additive, generate new IDs, preserve repayment relationships, and
are atomic; importing the same archive again creates another set of records.
Archives are limited to 25 MiB, 10,000 lents, 50,000 repayments, and 500
repayments per lent.

**Chit transfer** — the same page exports all chit funds and nested
installments as a versioned `pennywise-chits` JSON archive and previews a
selected archive before import. Imports are append-only: they create fresh
chits and installments, and importing the same file again creates duplicates.
The archive contains setup fields and installment fields only; IDs, timestamps,
status, counts, and totals are derived or ownership-specific and are omitted.
Exports and imports are bounded by 5 MiB raw JSON, 500 chits, 10,000
installments, 1 MiB of stored names/organizers/notes, 360 installments per
chit, and the existing money maximum. Full-account export over a limit returns
`413`; use **Export JSON** on an individual chit detail page as the fallback.
The frontend submits the BOM-stripped raw JSON text unchanged so the backend
can enforce exact numeric syntax.

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
- `src/api/auth.ts` — signup, login, logout, forgotPassword.

## Testing

Unit and component tests use **Vitest** with **Testing Library** (`jsdom`).

```bash
npm test              # vitest run (from frontend/)
```

Config: `vitest.config.ts`; setup: `src/test/setup.ts` (jest-dom matchers +
RTL cleanup). Tests live beside source as `*.test.ts` / `*.test.tsx`. Playwright
is installed for e2e but is separate from `npm test`.

## PWA

`vite-plugin-pwa` precaches the app shell. Client-side routes fall back to
`index.html`; `/api/*` is excluded from the service worker navigate fallback.

In production the Go server serves the embedded SPA with explicit cache headers:
`index.html`, `sw.js`, and `registerSW.js` are sent with `Cache-Control: no-cache`
so new deployments are picked up immediately; content-hashed files under
`assets/` are cached as immutable for one year (`spaHandler` in
`backend/internal/api/server.go`).
