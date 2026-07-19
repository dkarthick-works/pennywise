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
