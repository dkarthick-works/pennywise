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
