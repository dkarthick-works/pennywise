# Devlog

## 2026-07-14

### Session 1

Changed Daily and Income quick-add so the date defaults to the latest entry in that table instead of today’s calendar day. Added defaultDraftDate and wired it into both tiles; all four post-add resets keep the date via a functional setDraft so consecutive same-day backfill stays on the ledger’s last date.

**Decisions**

Favor last recorded date over today for quick-add defaults so back-filling continues where the ledger left off; user must bump the date when logging a newer day.
