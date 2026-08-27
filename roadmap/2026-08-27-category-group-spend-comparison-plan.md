# Category Group Spend Comparison — Implementation Plan

**Date:** 2026-08-27
**Status:** Implemented
**Product area:** Dashboard → Category Groups

## 1. Objective

Add a dedicated comparison experience that lets a user inspect one category group's spending across months, understand its transaction distribution, see which mapped categories contributed to the total, and switch directly to another category group without returning to the Dashboard.

This feature must preserve the existing category-group calculation semantics: a transaction belongs to a group when its normalized category text matches one of the group's current mappings. Do not add section or transaction-kind filters to group totals.

## 2. Agreed product decisions

### Included in the first release

- Enter the existing monthly transaction page by clicking a Category Group card on the Dashboard.
- From that transaction page, expose a small **Compare over time** CTA.
- Open comparison in a dedicated route/page; do not add comparison metrics to Dashboard cards.
- Compare the selected group over 3, 6, or 12 displayed months; default to 6 months.
- Compare the anchor (`to`) month with the immediately previous month.
- Show absolute and percentage change, with explicit zero-month handling.
- Show a clickable monthly trend chart.
- Clicking/viewing a chart month must allow the user to open that group's transactions for that month.
- Show transaction count, average transaction amount, median transaction amount, and largest transaction amount.
- Show the selected-range period average and current-month pacing.
- Show the group's share of Monthly Cost.
- Show the group's currently mapped categories so users understand what historical totals include.
- Show each mapped category's contribution to the anchor month’s group total.
- Allow switching category groups directly on the comparison page.
- Preserve the selected range and anchor month while switching groups.
- Return raw monthly buckets from the backend; derive comparisons, percentages, the period average, and pacing in the frontend.
- Return zero-valued monthly buckets when a group has no matching transactions.
- Support filtering the history API by stable group IDs; omitting IDs returns all user-owned groups.

### Explicitly excluded

- Generated contextual prose or explanations
- Unusual-spend detection or alert labels
- Recurring-versus-one-off classification
- New section or transaction-kind filters for category-group totals
- Historical/versioned category mappings
- Changes to the existing Dashboard Category Group card metrics
- Spending projections for the remainder of an incomplete month

## 3. Existing behavior and integration points

- `GET /api/dashboard/group-spend?month=YYYY-MM` returns `group_id`, `group_name`, and `total` for all groups. It includes every matching transaction, regardless of section or kind.
- `GET /api/category-groups/{id}/transactions?month=YYYY-MM` returns the selected group's matching transactions for one month.
- `GET /api/category-groups` returns all groups and their mapping IDs/raw category labels.
- `frontend/src/pages/DashboardPage.tsx` renders Category Group cards and routes the whole card to `/dashboard/groups/:groupId`.
- `frontend/src/pages/CategoryGroupPage.tsx` is the current group transaction detail page. It uses the app-level selected month and has a Dashboard back button.
- `frontend/src/App.tsx` owns the global month state and defines the category-group route.
- Category mappings are many-to-many across groups but unique within a group by `(user_id, group_id, normalized_category)`.
- Existing `DashboardMonthlyDTO.monthly_cost` already represents expense transactions in the `essential`, `flexible`, and `daily` sections whose kind is `cash` or `credit`; income and settlement transactions are excluded.

No database migration is expected. This feature needs new SQL queries, generated sqlc code, handlers, frontend types/API functions, routes, UI, and tests.

## 4. Calculation semantics

### 4.1 Group totals

For each group and month:

- Match transactions using the same normalization and mapping rules as the existing `SumSpendByGroupsForMonth` query.
- Include all matching transaction sections and kinds.
- Count each matching transaction once within an individual group.
- A transaction may appear in multiple groups when the user deliberately maps its category into multiple groups.
- Do not add totals from separate groups together or imply that groups form a mutually exclusive partition.

### 4.2 Current mappings applied historically

Historical results use the group's mappings at query time.

If the user adds a category mapping today, matching transactions from old months become part of the historical group totals. If the user removes a mapping, those transactions disappear from historical totals. This is intentional and must be communicated on the comparison page:

> Historical results use the categories currently included in this group.

Do not implement mapping snapshots or effective dates.

### 4.3 Monthly Cost denominator

“Share of monthly cost” is:

```text
group total for month / Monthly Cost for month × 100
```

Monthly Cost must use the existing Dashboard definition:

- Include expense transactions from `essential`, `flexible`, and `daily`.
- Include kinds `cash` and `credit`.
- Exclude income.
- Exclude settlements.

The numerator intentionally retains unrestricted category-group semantics. User-created groups can therefore produce unusual percentages, including values above 100%; do not clamp the percentage.

If Monthly Cost is zero, the percentage is unavailable and the UI must not divide by zero or display a fabricated 0%.

### 4.4 Empty-month values

For a group-month with no matching transactions, return:

```json
{
  "month": "2026-07",
  "total": 0,
  "transaction_count": 0,
  "average_transaction": null,
  "median_transaction": null,
  "largest_transaction": null,
  "categories": []
}
```

Use `null`, not zero, for statistics that do not exist because there are no transactions.

### 4.5 Previous-month comparison

Frontend rules:

| Previous bucket | Selected bucket | Presentation |
|---|---|---|
| zero transactions | zero transactions | “No transactions in either month” |
| zero transactions | non-zero transactions | “New spending · no transactions last month” |
| non-zero transactions | zero transactions | “No spending this month · down {previous total}” |
| non-zero transactions | non-zero transactions | Show signed absolute delta and signed percentage delta |

Percentage change is `(selected - previous) / previous × 100`. Never calculate it when the previous total is zero.

Transaction count is the authoritative way to identify “no transactions”; do not infer absence only from `total`, because a future negative/offsetting dataset could total zero while containing transactions.

### 4.6 Period average

- Calculate the period average in the frontend from exactly the buckets displayed in the chart.
- For a 3-month view, sum the anchor month and previous two months, then divide by 3.
- For a 6-month view, sum the anchor month and previous five months, then divide by 6.
- For a 12-month view, sum the anchor month and previous eleven months, then divide by 12.
- Include zero-transaction months in both the sum and divisor; they are real calendar months.
- Request exactly 3, 6, or 12 API buckets. No hidden calculation-only buckets are needed.
- The anchor (`to`) month remains the month being analyzed. Older chart months do not receive their own period-average calculations.

### 4.7 Current-month pacing

Only show pacing when the anchor month is the actual current local calendar month.

First-release pacing is intentionally simple:

```text
current month spend so far / selected-range period average × 100
```

Example: “₹6,000 spent so far · 75% of the 6-month average.”

- Do not project a month-end total.
- If the period average is zero, omit the percentage and state that no period average is available.
- Pacing uses transactions recorded so far; no day-normalization is required.
- Do not show pacing for completed historical anchor months or future anchor months.

### 4.8 Underlying-category contribution

For each monthly bucket, aggregate matching transactions by the mapping's normalized category and display the mapping's user-facing `raw_category` label. The first-release comparison page displays this breakdown for the anchor (`to`) bucket.

Frontend contribution percentage:

```text
mapped category total / selected group bucket total × 100
```

- If the group total is zero, show an empty-state message rather than percentages.
- Return only categories with matching transactions in the bucket; the separate mappings list remains the complete source of currently included categories.
- Sort contributions by total descending, then category label ascending for deterministic ties.

## 5. Backend API contract

### Endpoint

```http
GET /api/dashboard/group-spend/history?to=2026-08&months=6&group_ids=id1,id2
```

Register it with the other protected Dashboard routes in `backend/internal/api/server.go`.

### Query parameters

- `to` — required, valid `YYYY-MM`; this is the inclusive last bucket.
- `months` — required integer restricted to `3`, `6`, or `12`, matching the supported frontend ranges.
- `group_ids` — optional comma-separated UUIDs.
  - Omitted or blank means all groups owned by the authenticated user.
  - Trim whitespace and deduplicate IDs.
  - A malformed UUID returns `400`.
  - If any syntactically valid requested ID is not owned by the user, return `404` with a generic `category group not found` error.
  - Never return another user's group or reveal its name.

Validation failures must occur before running aggregation queries. Invalid calendar months such as `2026-13`, unsupported values such as `months=0`, `months=4`, or `months=13`, and non-integer values return `400`.

### Response

Keep Monthly Cost denominators top-level because they are shared by all groups.

```json
{
  "from": "2026-03",
  "to": "2026-08",
  "months": 6,
  "monthly_costs": [
    { "month": "2026-03", "total": 50000 },
    { "month": "2026-04", "total": 47000 }
  ],
  "groups": [
    {
      "group_id": "uuid",
      "group_name": "Online Food",
      "mappings": [
        { "id": "mapping-uuid", "category": "Swiggy" },
        { "id": "mapping-uuid", "category": "Zomato" }
      ],
      "buckets": [
        {
          "month": "2026-08",
          "total": 12000,
          "transaction_count": 16,
          "average_transaction": 750,
          "median_transaction": 540,
          "largest_transaction": 2100,
          "categories": [
            { "category": "Swiggy", "total": 7000, "transaction_count": 9 },
            { "category": "Zomato", "total": 5000, "transaction_count": 7 }
          ]
        }
      ]
    }
  ]
}
```

Contract guarantees:

- `from` and `to` are inclusive month labels.
- `months` is the number of buckets returned per group and in `monthly_costs`.
- `monthly_costs` is ascending by month and includes zero months.
- `groups` is ascending by group name.
- `mappings` is ascending by category label.
- Every group contains every requested month in ascending order.
- Group buckets with no transactions are explicit zero buckets.
- Category contributions are total-descending with category-label tie-breaking.
- An authenticated user with no groups receives `groups: []` but still receives the requested zero-filled `monthly_costs` series.
- Monetary JSON fields continue using the project's current number convention.

### DTO guidance

Create dedicated DTOs in a new handler file such as `backend/internal/api/group_spend_history.go`:

- `GroupSpendHistoryDTO`
- `MonthlyCostBucketDTO`
- `GroupSpendHistoryGroupDTO`
- `GroupSpendHistoryMappingDTO`
- `GroupSpendHistoryBucketDTO`
- `GroupCategoryContributionDTO`

Use pointer fields with `omitempty` disabled for average/median/largest so empty statistics serialize explicitly as `null`.

## 6. Backend data/query implementation

Add sqlc queries to `backend/db/queries/category_groups.sql` (or a focused new query file if preferred) and regenerate code with `make generate` from `backend/`.

Recommended query responsibilities:

1. **Validate/load selected groups and mappings**
   - Reuse `ListCategoryGroups`, `GetCategoryGroup`, and `ListCategoryMappingsByGroup`, or add a set-based user-owned group query to avoid N+1 loading.
   - Prefer a set-based query for all-group requests.

2. **Group/month aggregate**
   - Generate calendar month starts with PostgreSQL `generate_series` over the requested half-open date range.
   - Cross join selected user-owned groups with generated months so zero buckets exist.
   - Left join mappings and transactions using the existing normalized-category expression.
   - Aggregate `SUM(amount)`, `COUNT(transaction id)`, `AVG(amount)`, `percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)`, and `MAX(amount)`.
   - Ensure the mapping join cannot multiply a transaction within one group; the current unique constraint supports this.

3. **Group/month/category aggregate**
   - Aggregate matched rows by group, month, and mapping.
   - Return mapping label, total, and transaction count.
   - It does not need to manufacture zero contribution rows because mappings are returned separately.

4. **Monthly Cost series**
   - Generate the same calendar months.
   - Aggregate the existing Monthly Cost definition per month: expense sections plus `kind IN ('cash', 'credit')`.
   - Return explicit zero months.
   - Keep this definition aligned with `SumDashboardMonthly`; consider a SQL comment documenting that the two definitions must remain synchronized.

The handler should assemble query rows into the nested response using maps keyed by group ID and month, while preinitializing ordered zero buckets. Do not depend on database row order alone when constructing the response.

Run all reads used to build one history response inside one PostgreSQL read-only, repeatable-read transaction so mappings, group aggregates, category contributions, and Monthly Cost values all observe the same snapshot:

1. Start with `s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})`.
2. Create transaction-bound queries with `qtx := s.q.WithTx(tx)`.
3. Execute every validation/load/aggregate query through `qtx`; do not mix transaction-bound and pool-bound reads.
4. Defer rollback for error paths and commit only after the complete DTO has been assembled successfully.
5. Return an internal-server error if begin, any query, or commit fails.

This snapshot is a deliberate correctness and learning choice even though concurrent edits are unlikely in this single-user workflow.

Date range:

- Parse `to` with the existing month validation/date helpers.
- Inclusive final bucket starts at `to` month.
- First bucket starts `months - 1` months before `to`.
- SQL transaction range is half-open: `[first month start, month after to)`.

No migration is needed unless implementation uncovers a missing index. Existing indexes on mappings and transaction ownership/date/category should be reviewed with `EXPLAIN`; add a migration only if measured query plans justify it.

## 7. Backend tests

Create focused integration coverage, likely `backend/internal/api/group_spend_history_test.go`, using the existing `setupCategoryAPITest` infrastructure and `PENNYWISE_TEST_DATABASE_URL`.

Cover:

1. Correct inclusive month range and ascending zero-filled buckets.
2. All groups returned when `group_ids` is omitted.
3. Only requested groups returned when IDs are supplied.
4. Duplicate requested IDs do not duplicate groups.
5. Malformed group ID returns `400`.
6. Valid but missing/other-user group ID returns `404` without data leakage.
7. Invalid/missing `to` returns `400`, including impossible month 13.
8. Invalid/missing `months`, zero, negative, non-integer, and unsupported values other than 3/6/12 return `400`.
9. Group totals include matching income and settlement rows, preserving current unrestricted semantics.
10. Monthly Cost excludes income and settlement and includes cash/credit expense rows.
11. Empty months have total/count zero and null average/median/largest.
12. Average, median, largest, and count are correct for odd and even transaction counts.
13. Underlying-category totals and counts reconcile to the group bucket.
14. Category normalization matches case/whitespace variants consistently with existing endpoints.
15. The same category mapped into two groups contributes independently to both groups.
16. Changing/removing a mapping changes historical output, confirming current-mapping semantics.
17. A group with no mappings still appears with zero buckets and an empty mapping list.
18. A user with no groups receives an empty group array and zero-filled Monthly Cost buckets.
19. Response arrays are non-null and deterministically ordered.
20. Existing `/api/dashboard/group-spend` and group transaction tests remain passing.

## 8. Frontend types and API layer

In `frontend/src/types/index.ts`, add interfaces matching the API response, including nullable statistics:

- `GroupSpendHistoryResponse`
- `MonthlyCostHistoryBucket`
- `GroupSpendHistoryGroup`
- `GroupSpendHistoryMapping`
- `GroupSpendHistoryBucket`
- `GroupCategoryContribution`

In `frontend/src/api/ledger.ts`, add:

```ts
getGroupSpendHistory({ to, months, groupIds, signal? })
```

- Serialize `group_ids` only when a non-empty list is supplied.
- Add a centralized React Query key factory, for example:

```ts
groupSpendHistoryKeys.all
groupSpendHistoryKeys.detail(groupId, to, months)
```

- Ensure existing category mapping/group mutations invalidate both existing `group-spend` queries and all history queries. Extend the central invalidation in `frontend/src/lib/monthCaches.ts` and relevant category mutation call sites.

## 9. Frontend routing and state

Add a dedicated route:

```text
/dashboard/groups/:groupId/compare
```

Recommended URL query state:

```text
/dashboard/groups/:groupId/compare?to=2026-08&range=6
```

- `range` accepts 3, 6, or 12; default 6.
- `to` is both the inclusive chart endpoint and the anchor month being analyzed; default to the app's current selected month.
- Invalid query values should be normalized to defaults with `replace` navigation so malformed URLs do not persist.
- Changing range should retain `to` and request exactly `range` API buckets.
- Switching groups must preserve `to` and `range` and should use replace navigation to avoid filling browser history with every dropdown selection.
- The URL makes comparison pages refresh-safe and directly linkable.

Update the existing transaction detail route to support an optional `?month=YYYY-MM` query value:

- A valid query month takes precedence over the app-level month prop.
- If absent, retain current behavior using the app-level selected month.
- The page-level Transactions action includes the anchor month in the URL; activating an older chart bucket includes that bucket's month.
- Do not require a Dashboard round trip.

## 10. Transaction-page changes

Update `frontend/src/pages/CategoryGroupPage.tsx`:

- Keep the existing transaction-first experience and Dashboard back button.
- Add a small **Compare over time** CTA near the title/total, not inside each transaction row.
- CTA route: `/dashboard/groups/:groupId/compare?to={activeMonth}&range=6`.
- Respect the optional route query month when loading transactions and rendering the subtitle.
- Preserve existing loading, error, and empty states.
- Do not add historical metrics to this page.

## 11. Comparison page

Create `frontend/src/pages/CategoryGroupComparisonPage.tsx` and smaller components/helpers where useful rather than placing all logic in one component.

### Header and navigation

- Dashboard back action.
- Searchable category-group selector, alphabetically ordered, with the current group selected.
- Load selector data from `GET /api/category-groups`; load history only for the active group ID to keep the response focused. The backend's omitted-ID behavior still remains supported and tested.
- **Transactions** action that opens the selected group's transaction page for the anchor month.
- Clear page title: “Compare over time”.
- If the URL group does not exist or was deleted, show a not-found state while keeping the group selector available.

For accessibility, use a native `<select>` initially unless the existing design system has an accessible searchable combobox. If search is required for large lists, implement a labeled input/listbox with full keyboard behavior rather than an inaccessible custom dropdown.

### Included categories

- Render current mapped category labels near the top.
- For a small number, show chips.
- For a larger list, show a collapsed “Included categories · N” control with an explicit Show/Hide action.
- Include the current-mapping historical note.
- Empty mapping state: “No categories are currently included in this group.”

### Range controls

- Segmented control for 3, 6, and 12 months.
- Default 6.
- Selected state must be keyboard accessible and reflected in URL state.

### Trend chart

- Display all 3/6/12 requested buckets.
- Use an accessible bar or line chart consistent with existing chart primitives in `frontend/src/components/charts/Charts.tsx`.
- Every bucket, including zero months, must be represented.
- Activating an older chart bucket opens that group's transaction page with the bucket month in `?month=YYYY-MM`; it does not re-anchor or recalculate the comparison page.
- Provide an accessible label containing month, total, and transaction count.
- Clearly distinguish the anchor (`to`) bucket.
- Provide a **View transactions** action for the anchor month as well.

### Anchor-month summary

Display:

- Selected month label
- Group total
- Previous-month absolute/percentage comparison according to the zero rules
- Transaction count
- Average transaction value or “—”
- Median transaction value or “—”
- Largest transaction or “—”
- Selected-range period average
- Share of Monthly Cost
- Current-month pacing only when applicable

Do not show contextual/generated explanation text.

### Contribution breakdown

- Use the anchor (`to`) bucket's `categories` array.
- Show category label, amount, transaction count, and percentage of the group bucket.
- Sort according to the API contract, but do not rely on frontend object iteration order.
- Empty state for a zero/no-transaction month.
- Do not confuse the complete “Included categories” list with the anchor month's active contribution list.

### Loading/error states

- Keep the header/group selector stable while a group history query changes.
- Show a content skeleton/loading state for the chart and metrics.
- Provide a Retry action on history failure.
- Distinguish no groups, missing group, group with no mappings, and group with mappings but no transactions.
- Avoid flashing the previous group's numbers under the newly selected group name; React Query placeholder data must not create misleading cross-group content.

## 12. Frontend calculation helpers

Create pure helpers, likely under `frontend/src/lib/groupSpendComparison.ts`, for:

- Visible-range bucket handling
- Finding the anchor and previous-month buckets
- Absolute and percentage delta states
- Selected-range period average including zero months
- Monthly Cost lookup and share calculation
- Current-month pacing eligibility and percentage
- Contribution percentages
- Query parameter normalization

Keep display formatting (`inr`, month labels) separate from numeric calculation where practical.

Unit-test helpers for zero denominators, no-transaction buckets, negative/positive deltas, percentage-over-100 behavior, range slicing, and current-month detection.

## 13. Frontend tests

Add `CategoryGroupComparisonPage.test.tsx` and extend `CategoryGroupPage`/routing tests.

Cover:

1. Transaction page exposes the comparison CTA with the active month.
2. Transaction page honors a valid `?month=` query.
3. Default comparison range requests and renders exactly six months.
4. Range controls request and render exactly 3/6/12 buckets.
5. Group selector switches route and query while preserving comparison state.
6. Switching groups does not require Dashboard navigation.
7. Included mapping labels and historical-current-mappings note render.
8. Empty mappings state renders.
9. Trend includes zero months, and activating an older month opens that month's transactions without recalculating the comparison page.
10. View Transactions links to the selected group and anchor month.
11. Normal delta renders amount and percentage.
12. All three zero-month comparison branches render correctly.
13. Empty statistics render as unavailable, not ₹0.
14. Period average uses all displayed buckets and includes zero buckets in the divisor.
15. Pacing appears only for the real current month and never projects a future total.
16. Monthly Cost share uses the matching month, can exceed 100%, and is unavailable for a zero denominator.
17. Contribution rows show amount/count/percentage and empty state.
18. Loading, retryable error, no-groups, and deleted-group states.
19. Invalid URL range/month/selected values normalize safely.
20. Controls have accessible names and can be operated by keyboard.
21. Existing Dashboard cards remain visually/data-wise unchanged and still open transaction detail.

## 14. Documentation

Update:

- `backend/README.md` with endpoint parameters, response, ordering, zero semantics, current-mapping behavior, unrestricted group totals, and Monthly Cost denominator.
- `frontend/README.md` with the new route, transaction-to-comparison flow, group switching, chart behavior, and metric definitions.
- Any API table in `backend/README.md` to include the history endpoint.

Use user-facing terminology consistently:

- “Category group” for the user-defined collection
- “Included categories” for mappings
- “Share of monthly cost” for the denominator metric
- “Compare over time” for the feature entry point

## 15. Implementation order

1. Add SQL queries and generate sqlc output.
2. Implement handler parsing, validation, DTO assembly, and route registration.
3. Add backend integration tests and verify existing group/dashboard endpoints.
4. Add frontend response types, API client, query keys, and cache invalidation.
5. Add calculation helpers and unit tests.
6. Add URL-aware month handling and comparison CTA to the transaction page.
7. Add comparison route/page, group selector, mappings display, range control, and loading/error states.
8. Add chart selection, summary metrics, pacing, Monthly Cost share, contribution breakdown, and transaction navigation.
9. Add page/component tests and route tests.
10. Update backend/frontend documentation.
11. Run formatting, generation, tests, lint, and builds.
12. Invoke the project `app-story` workflow because this is a user-facing feature.
13. Run `graphify update .` after code changes to refresh the project graph.

## 16. Verification commands

From `backend/`:

```bash
make generate
gofmt -w internal/api/*.go
go test ./...
go build ./...
```

Database integration tests require `PENNYWISE_TEST_DATABASE_URL`.

From `frontend/`:

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

From project root after implementation:

```bash
graphify update .
```

## 17. Acceptance criteria

The feature is complete when:

- A user can open a group on Dashboard, view its monthly transactions, and enter Compare over time.
- The comparison page supports 3/6/12-month views with a 6-month default.
- All requested calendar months appear, including zero months.
- Previous-month comparisons follow the agreed zero rules.
- Count, average, median, largest amount, selected-range period average, pacing, and Monthly Cost share are correct.
- Current mapped categories and the current-mapping historical note are visible.
- The anchor month's underlying-category contributions reconcile to the group total.
- The user can switch directly between groups without returning to Dashboard.
- Range/month state survives group switching and page refresh through URL state.
- The selected chart month can open the correct transaction detail month.
- Income/settlement remain eligible for group totals when mapped, while the Monthly Cost denominator excludes them.
- No contextual insight, anomaly detection, or recurring classification is introduced.
- Existing Dashboard group cards and current group transaction behavior remain intact.
- Backend and frontend tests, lint, generation, and builds pass.
