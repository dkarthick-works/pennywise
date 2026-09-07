# Events frontend implementation plan

Status: proposed; planning only, no frontend implementation authorized yet.

## 1. Product scope and navigation

Events is a standalone top-level section in the existing application sidebar, alongside Dashboard, Lent, Chit funds, and Insights. It is not a new home screen or a subsection of Record Expense. Keep `/` redirecting to `/record`.

Interpret “credit operations” as CRUD (create, read, update, delete); no credit/settlement/payment integration is introduced. Actual event cost includes unpaid bills and remains independent of Transactions.

Deliver the sidebar and complete Events CRUD experience first (Phase A). The previously agreed cash-flow suggestions are a separate Phase B in this plan, not a prerequisite for using the Events section. Do not add suggestions to the initial Record Expense screen.

### Sidebar placement

Add Events after Chit funds and before Insights in `frontend/src/components/layout/AppShell.tsx` (`NAV_MAIN`). Add an appropriate calendar/list icon in `components/ui/Icons.tsx`, following existing icon conventions. The same navigation supplies the mobile drawer; selecting Events should close it as existing entries do. All `/events/*` routes keep Events highlighted.

### Authenticated routes

| Route | Screen |
| --- | --- |
| `/events` | List and status filters |
| `/events/new` | Create event |
| `/events/:id` | Event details and actions |
| `/events/:id/edit` | Full event editor |

Wire inside existing RequireAuth/AppShell routing in `frontend/src/App.tsx`. No new router, navigation library, or dependencies needed.

## 2. Existing patterns and caveats

- `ChitsPage.tsx`, `ChitCreatePage.tsx`, `ChitDetailPage.tsx`, and `ChitEditPage.tsx` provide page hierarchy and visual references, not business rules to copy.
- Use existing `content`, `page-head`, `card`, `field`, `input`, `btn`, `tbl`, and status-chip styles. Add scoped event styles to `src/index.css` where needed.
- Use the shared authenticated Axios client in `src/api/client.ts` and TanStack Query v5.
- Do NOT copy Chits' error unwrapping unchanged: it drops HTTP status information needed to distinguish Events 409 conflicts and 404 deletion.
- Do NOT copy the edit page's unconditional query-data-to-form effect: a background refetch must not overwrite a dirty event draft.
- Use `money2`, not `inr`, for event costs; `inr` rounds away paise. Dates are calendar strings, not UTC timestamps.
- Backend `PUT /api/events/:id` replaces the entire editable aggregate; there is no status-only PATCH or individual-item endpoint.
- Backend is the source of truth for totals, completeness, completion eligibility, and recommendations. No variance, local affordability calculation, or predicted savings.

## 3. Events list

Header: **Events**, short subtitle “Plan costs and track what your events actually cost,” and **Create event** button.

Status filter: All (default), Planned, In progress, Completed, Cancelled. Persist status and offset in URL search params; validate unknown values and reset offset on filter change. Events are not filtered by the app's selected transaction month.

Desktop table columns:
- Event name (real keyboard-accessible link to detail)
- Flexible date, or “No date”
- Status
- Expected total
- Actual incurred so far
- Suggestion preference (On/Off, read-only here)

Show backend completeness alongside totals: “Estimate incomplete · 2 missing” or “Actuals incomplete · 1 missing.” A partial sum is “Known expected total” / “Recorded actual total,” not a finished budget. Use summary flags rather than deriving them from fetched items. Empty/no-actual events must not visually imply a finalized zero cost.

Use bounded API pagination, default limit 50, Previous/Next with has_more; no invented total-page count. On deleting the final result on a nonfirst page, step back to the prior page. Preserve filters/page when navigating back from detail, without accepting arbitrary external return URLs.

On narrow screens use stacked event cards with the same values/actions, not an overflowing full-width table. Do not duplicate accessible content by rendering both layouts visibly.

States: loading, retryable error, no events with Create action, and no matching status results with Clear filter. Distinguish failed loads from genuine empty data.

## 4. Create/edit form

Share one `EventForm` and line-item editor across create/edit pages.

Metadata:
- Required name, max 200 characters.
- Optional target date with clear action; label “Flexible date.” Explain it can be changed later, not a deadline.
- Optional note, max 5,000 characters.
- Explicit status selector; create defaults Planned.
- Checkbox default on: **Suggest this when it fits my free money**.

Line items:
- Name, Expected cost, Actual incurred so far.
- Add item, Remove item, Move up/down controls. No drag-and-drop dependency; controls must work by keyboard and touch.
- Desktop aligned columns; mobile stacked rows with repeated labels.
- Local stable row key independent of array index; retained backend IDs stay attached when rows move.
- New form starts with an empty item list plus prominent Add item. Saving an event without items is valid. Never silently drop a half-entered row; a row with no name must be corrected or explicitly removed.
- At most 500 items. Confirm removing a saved row, particularly when it has an entered actual; explain removal takes effect on Save and that removed items have no restore/history.

### Money and null handling

Keep editable costs as strings. Empty input serializes to null; explicit "0" to numeric zero. Avoid `parseFloat(value) || 0`, `value || ""`, or any coercion collapsing missing and zero. Validate nonnegative decimal input and at most two fractional digits before conversion; reject malformed text rather than truncating it. Enforce the existing per-item maximum `999999999999.99`.

Use inputMode decimal and appropriate accessible labels; no currency symbols/grouping in submitted values. Retain exact draft text until submission. Formatting values for display is frontend presentation; backend still computes all financial summaries.

### Save behaviour

Explicit Save/Create, not autosave. Disable duplicate submission and conflicting form actions while pending. No optimistic writes: navigate/update caches from the successful server response.

PUT sends every required metadata field, the original loaded version, and the complete ordered item list. Existing IDs are preserved; new items omit IDs; removed items are absent. Do not send response-only summary, timestamps, position, or user identity fields.

Show saved backend totals on edit as “Last saved totals” and state they update after Save. Do not display them as live draft totals. New-event totals first appear after successful creation. Local field validation can guide input, but it must not recreate backend financial/completeness calculations.

Completion rule errors are authoritative server messages: empty events cannot complete, and each item needs actual cost (zero accepted). Missing expected costs do not prevent completion. A user can reopen and clear actuals in the same PUT; never change status implicitly to make a request valid.

### Dirty drafts and conflicts

Initialize a draft once per loaded event/version, and retain its base version until save or explicit discard/reload. Query refetches may update server cache but must not silently rebase or replace that draft.

On 409: keep the draft and display “This event changed elsewhere. Reload the latest version before saving.” Disable blind resubmission. Offer **Discard draft and reload** with confirmation. Do not auto-merge, overwrite, or silently retry using the latest version.

On 404: “This event is no longer available”; preserve unsaved text until the user explicitly leaves/discards it, and provide All events navigation. Do not claim whether another user's record exists.

Cancel/back controls confirm discarding changes. Add beforeunload warning while dirty. For sidebar/browser-history SPA navigation, the app currently uses declarative BrowserRouter; do not assume useBlocker works without a data router. Add a narrowly scoped dirty-navigation guard compatible with the existing router, or explicitly document that only controlled exits and browser unload are guarded. Do not migrate the whole app router as incidental Events work.

Network failures retain the draft. Do not automatically retry create or duplicate mutations (their backend operations are not idempotent). For an ambiguous timeout, tell the user to check the Events list before creating again.

## 5. Detail and lifecycle actions

Display name, status, flexible date, note, suggestion preference, ordered items, and backend expected/actual summaries. Null item costs display “Not entered”; explicit zeros display ₹0.

Always show a concise accounting note:
> Event costs are tracked separately and do not update cash flow. Record payments in Transactions to include them there.

Primary action: **Edit event** (also how users enter/update actual costs). Secondary actions: **Duplicate** and **Delete**, with explicit status controls for Start / Complete / Cancel / Move back to Planned as appropriate. All states remain editable.

Use backend `summary.can_complete` to disable Complete when the saved event is incomplete, with guidance to edit actual costs. Status actions submit a full PUT from the displayed saved detail and its version; use one shared serializer, not separate hand-built payloads. Disable competing actions while any mutation is pending. A concurrent change produces the same 409 recovery flow; never replace the expected version behind the user's back.

### Duplicate

A small labelled confirmation form allows optional name/date overrides and explains: copies items/estimates and suggestion preference, resets status to Planned, clears actuals and date by default. Empty optional override fields are omitted, so server defaults apply. POST `{}` is a valid default duplicate request. On success navigate to the new event's edit page. Do not implement client-side cloning followed by create.

### Soft delete

Confirmation names the event and explains it will disappear from Events and suggestions; no restore is available in this version. Do not claim the stored data is permanently erased and do not show an Undo button.

Send DELETE with `If-Match: "<version>"`. On success remove detail cache, invalidate list/suggestions, and return to Events. Conflict requires reload and a fresh confirmation; do not auto-retry deletion. A 404 means already unavailable and can return to the list with a notice.

## 6. API types, hooks, and cache ownership

Add `src/api/events.ts` and Events-specific types (use names such as `PlannedEventDetail`/`EventSummaryDTO`, not the DOM `Event` type). Cover list envelope, metadata, items, nullable costs/date, summary flags/counts, statuses, mutation payloads, and suggestion response (including nullable free_money).

Wrappers: listEvents, getEvent, createEvent, updateEvent (PUT), deleteEvent (quoted If-Match), duplicateEvent, getEventSuggestions. Preserve status and server message through an Events API error type or preserved Axios errors; do not alter global auth handling.

Central query keys, for example:
- `["events", "list", {status, limit, offset}]`
- `["events", "detail", id]`
- `["event-suggestions", month, timezone, limit, offset]`

Centralize mutations/invalidation in `src/hooks/useEvents.ts`:
- Create/update/duplicate seed returned detail and invalidate all event lists/suggestions.
- Delete removes detail and invalidates lists/suggestions; cancel/remove outstanding detail queries so stale reads cannot repopulate deleted records.
- Event writes do NOT invalidate transaction/budget/dashboard financial caches; these values do not change.
- Detail/list queries handle 404 without repeated retries; retry normal reads consistently with existing query defaults. Mutations do not retry automatically.

## 7. Phase B: cash-flow suggestions

Integrate a separate `EventSuggestions` component into `CashFlowTransactionsPage.tsx` beneath the existing totals block, retaining Events as the primary management entry point. No new recommendations on Record Expense and no changes to free-money presentation/formula.

- Fetch only while viewing the current local calendar month; backend independently enforces this.
- Supply browser IANA timezone via Intl API (UTC fallback) and selected month. Query key includes timezone/month/pagination.
- Use only API-returned candidates and ordering. Never compare costs against dashboard data locally or subtract one recommendation from another.
- Compact cards show name, expected total, optional date, and View event link. Heading can say “Events you could consider this month.” No separate recommendation-explanation fields or reservation controls.
- Historical/future views hide the section entirely. Current-month empty results show a low-emphasis empty state with All events link; zero/negative free money never presents suggestions.
- Errors affect only this section, with retry; never hide cash-flow totals.
- Re-evaluate calendar context on focus/visibility and a month-boundary timer; old cached recommendations must disappear at month rollover even if the screen stays open.
- Event mutations invalidate suggestion keys. Financial mutations also invalidate them because the source allowance changed: extend `invalidateMonthCaches` and `useMonthlyBudget.ts`, audit direct transaction/import mutation invalidations, and test this dependency. This direction is intentionally asymmetric: transactions/budgets affect suggestions, Events does not affect financial totals.

Phase A can ship independently; Phase B is a distinct implementation step to preserve the user's requested sidebar-first priority.

## 8. Implementation files and sequence

1. Types + `src/api/events.ts` + API contract tests.
2. Draft serialization/field validation helpers in `src/lib/events.ts`; query keys/mutations in `src/hooks/useEvents.ts`.
3. Shared components under `src/components/events/`: EventStatusChip, EventSummary, EventForm, EventItemsEditor, and focused confirmation UI as needed.
4. `EventsPage.tsx`, `EventCreatePage.tsx`, `EventDetailPage.tsx`, `EventEditPage.tsx`.
5. Sidebar icon/navigation, authenticated routes, responsive scoped styles.
6. Phase A tests/manual review; no backend contract changes expected.
7. Optional separate Phase B delivery: suggestions component, cash-flow integration, and financial invalidation dependencies.
8. Update `frontend/README.md`; append app-story changelog/design decisions when shipped; run `graphify update .` after implementation. Do not rewrite the agreed backend plan.

## 9. Verification and acceptance

Vitest/Testing Library:
- Sidebar entry, active nested routes, mobile drawer dismissal, protected deep links.
- List loading/error/empty/filter/pagination behaviour, preserved return context.
- Create defaults, save without items, null vs zero, paise, date clearing, limits/invalid input.
- Stable IDs/order through edit; full PUT fields/version; adding/removing rows.
- Server-summary rendering, partial totals, no variance/local totals calculation.
- Explicit status transitions; completion guidance and authoritative API failures; completed editing/reopening.
- Duplication reset behaviour, no automatic retry, navigation to returned ID.
- Delete header/confirmation, 409/404 handling, no fake Undo, cache removal.
- Dirty draft survives background refetch, validation/network error, and conflict; reload requires explicit discard.
- Keyboard labels/focus and mobile layout; no clickable-row-only navigation.
- Suggestions phase: timezone/month gate, month rollover, zero/negative/empty states, API ordering, pagination, links, mutation invalidation, and isolation of loading failures.

Playwright (follow existing fixture conventions, no new dependency): desktop/mobile create → edit items/actuals → complete → duplicate → soft-delete; browser navigation/conflict handling. Prefer mocked API for deterministic UI tests, plus a disposable-backend smoke run when available. Never run destructive E2E workflows against production data.

Commands from frontend: `npm test`, `npm run build`, `npm run lint`, and relevant `npm run test:e2e` cases. Report unavailable browser/environment-dependent checks accurately.

Acceptance: Events is reachable from the standard sidebar/mobile menu; all CRUD/lifecycle operations work through the existing API; incomplete values remain clear; financial totals remain unchanged; no frontend implementation starts until this plan is approved.
