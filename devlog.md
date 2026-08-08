# Devlog

## 2026-07-14

### Session 1

Changed Daily and Income quick-add so the date defaults to the latest entry in that table instead of today’s calendar day. Added defaultDraftDate and wired it into both tiles; all four post-add resets keep the date via a functional setDraft so consecutive same-day backfill stays on the ledger’s last date.

**Decisions**

Favor last recorded date over today for quick-add defaults so back-filling continues where the ledger left off; user must bump the date when logging a newer day.

### Session 2

Shipped the Lent tracker UI against the new /api/lents backend: types, dedicated API client (PATCH + error unwrap), list page with open/settled/all filter and create form, and a detail page for edit/delete plus partial repayments. Wired /lents and /lents/:id into the shell and placed Lent in the sidebar after Dashboard. Kept repayments loaded only from GET detail, hid the repay form when settled, and used soft amount caps so editing an instalment is not wrongly limited to outstanding alone.

**Decisions**

Lent stays a separate ledger from transactions — not on Dashboard/Record/CSV. List defaults to open; outstanding is always the open-total summary. Edit-repayment soft-cap is outstanding + that row; create-cap is outstanding.

## 2026-07-19

### Session 1

Added a GitHub source-repo link to the login screen. Introduced a new IconGithub octocat component in the shared Icons set (filled, currentColor so it themes with the app), wired an external link with aria-label and rel=noopener below the sign-in/register switch in AuthPage, and styled it via a muted .auth-github rule that darkens on hover. Type-check passed clean; committed the three source files and pushed to main.

**Decisions**

Rendered the icon as a React component in Icons.tsx rather than reusing public/icons.svg, which is unused by the SPA and hardcodes #08060d instead of theming.

### Session 2

Shipped full-stack credit usage by calendar month and statement cycle. Backend: migration 0008 adds nullable user_settings.credit_statement_day (1..31 CHECK), new sqlc queries (SumCreditUsage, ListCreditTransactionsByDateRange, UpdateCreditStatementDay), a statementCycleRange helper, and three endpoints — PUT /api/settings/credit-billing-cycle plus GET /api/dashboard/credit-usage and /credit-transactions. Frontend: Settings billing-cycle card with live preview, dashboard card consuming the summary API, URL-driven drill-down, cross-month cache invalidation, and a new vitest suite. Committed and pushed to main.

**Decisions**

One global statement closing day (inclusive last day), derived from selected month not today; short-month days clamp independently per month. Totals are backend-authoritative (frontend never re-aggregates); unconfigured cycle shows a CTA, never zero. Any txn mutation/import/setting change invalidates the whole credit key space since cross-month cycles overlap.

### Session 3

Shipped an optional credit spending threshold: Settings stores a positive amount (or null to disable) under Credit card controls, and the Dashboard CC Usage card compares it independently to statement-cycle and calendar-month credit purchases with a within/over marker. Backend validates amounts lexically into NUMERIC (no float round-trip); also fixed statement-day clear so explicit JSON null is distinguished from a missing property. Tightened the hero card afterward — compact threshold bar, shorter “CC Usage” / “by recorded date” labels — so sibling hero cards stop stretching with blank space.

**Decisions**

Threshold is a soft per-period purchase warning, not a credit limit; null-only disable; same value applied to both windows. Exact decimal write path; Save/Clear (not budget autosave). Compact marker keeps hero row height balanced.

## 2026-07-20

### Session 1

Shipped Copy last month on Income, Essential, and Flexible record tiles. Eligible prior-month rows (non-empty category, amount > 0; income cash-only; essential/flexible cash or credit; settlements skipped) are remapped into the open month with day clamping for short months and leap years. New rows go through the existing atomic import endpoint; matching zero-value cash rows are filled best-effort via updateTxn. Confirm dialog shows fill vs insert counts, aria-live reports success/partial/error, and month navigation locks while the copy is in flight. Daily stays excluded. Committed and pushed to main.

**Decisions**

Frontend-only: atomic inserts via importTransactions plus best-effort fills — overall copy is not end-to-end atomic; partial-fill warns against retry. Zero-row matches are any same-category zero cash row (no seed provenance), case-sensitive after trim.

## 2026-07-21

### Session 1

Shipped isolated Chit funds: own Postgres tables and /api/chits CRUD with installment create/edit/delete, count-based active/completed status, metadata locks after the first installment, and FOR UPDATE cap enforcement. Frontend nav section covers list, create, detail, edit, and add-installment pages so browse surfaces stay read-first. Installments never touch ledger transactions, dashboard, or CSV export. Pushed to main; app-story updated.

**Decisions**

Chits stay off the transaction ledger. Progress is installment_count vs total_installments (no stored status). After the first installment, start_month, expected_monthly, and total_installments lock. Create/edit/add-installment are separate routes; list and detail stay read-first.

## 2026-08-06

### Session 1

Shipped a Daily spend by day bar chart on the monthly Dashboard under the hero cards. Client-side buckets from the existing month-txns query fill every calendar day with Daily cash+credit totals (settlements excluded), with sparse labels, custom tooltips, today highlight, skeleton/error states, and a header total. Tightened incurred kind checks to explicit cash|credit so the chart and Daily section card stay aligned. Committed and pushed to main; app-story updated.

**Decisions**

Future-dated Daily txns stay in the series so the header matches the Daily card. Chart uses shared isIncurredExpenseKind rather than kind !== settlement. Skeleton only on isPending; no fake ₹0 while loading or failed.

## 2026-08-07

### Session 1

Extended the Daily spend by day Dashboard chart with a header average. Past and future months use full-series total over calendar days; the current month averages spend through today over elapsed days and labels it “so far,” so future-dated rows stay in the month total but not the pacing numerator. Added helper tests and Dashboard coverage, then pushed to main; app-story updated.

**Decisions**

Option C pacing: current-month avg caps the numerator at today so “so far” stays honest. Header total remains the full chart series.
