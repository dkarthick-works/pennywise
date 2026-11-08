# Phase 5 — SMS Draft review and approval

## Shipped flow

Open **SMS Drafts** from the Tools menu (web or Android WebView), or from Settings → Android SMS import. Review one draft at a time. Edit the transaction name, date, amount, section and cash/credit kind.

- **Save draft edits** persists changes without creating a Transaction. A section can remain unset.
- **Approve and save Transaction** validates all fields, requires a section, and saves exactly one Transaction through `POST /api/transactions`.
- **Ignore** requires inline confirmation, removes the draft from review, and creates no Transaction. There is no restore action in this release.
- **Processing failures** is separate from drafts. Retry resumes only the failed stage, subject to existing consent, allowlist and seven-day source retention rules.
- Refresh is manual so new processing results do not interrupt review. Drafts and failures have Load more controls. Rejected SMS never enter the review list.

Settlement-like drafts remain cash proposals with warnings; settlement linking is not offered. Income must use cash. Original AI warnings remain visible after edits; they describe the source interpretation, not an updated AI assessment.

## API and consistency

Migration `0018_sms_draft_review` adds a positive `revision` to drafts.

- `GET /api/sms/drafts?offset=0` adds `revision` and `possible_duplicate`.
- `PUT /api/sms/drafts/{id}` accepts the basic transaction fields plus `revision`. Empty `section` is stored as NULL. Positive amount and cash/credit kind are required.
- `POST /api/sms/drafts/{id}/ignore` accepts `{ "revision": 1 }`.
- `POST /api/transactions` optionally accepts `sms_draft_id` and `sms_draft_revision` alongside its existing transaction input. Ordinary creation remains unchanged.
- `GET /api/sms/jobs?status=failed&offset=0` filters failures before pagination (100 per page). Existing unfiltered callers remain supported.

All routes require web authentication, not an SMS device token. Updates, Ignore and approval lock the same owner-scoped source/draft rows. Only `pending_review` and the exact current revision are eligible. A foreign draft returns 404; stale or already reviewed drafts return 409. A replay after a lost success response returns 409, not a second Transaction; Refresh reconciles the list.

Approval inserts the Transaction, stores the user's final draft values, advances the revision, and links/marks the source approved in **one database transaction**. Any failure rolls back all changes. Concurrent approval/Ignore can have only one winner. Deleting an approved ledger Transaction does not re-open the SMS source. Currency must still match the ledger currency; approval does not convert currencies or silently reinterpret an amount.

Completed review drafts remain reviewable if the device is later disabled; disabling stops ingestion/AI work, not a user's explicit ledger action. This preserves the Phase 4 cancellation boundary.

## Duplicate warning

The list flags a possible duplicate when any owner-scoped saved Transaction has the same date and amount as the persisted Draft. This is an advisory check, not proof that the records are identical. It is not a unique ledger constraint and does not block a deliberate approval. Unsaved edits do not recompute the warning; Save draft edits or Refresh obtains a new check. Fingerprint deduplication and source-level approval locking remain separate guarantees.

## Tests and rollout

- Go integration tests: owner/device isolation, saved edits, optional section, stale revision, invalid input, currency mismatch, approval linkage, replay after ledger deletion, concurrent approval/Ignore, and rollback after a forced source-update failure.
- React tests: required section, edits, confirmation, pending double-click protection, recoverable failures, pagination, failed-stage retry and ledger cache invalidation.
- Playwright fixtures: the review/save/approve/retry workflow at desktop and mobile widths, with no live AI or private SMS.
- Migration round trips run as part of the API regression suite.

Apply migrations through the normal backend startup, deploy the frontend, and rebuild Android to receive its updated disclosure text. `SMS_AI_ENABLED` remains off by default. Scheduling, automatic foreground scans, history-based learning and settlement linking are not part of Phase 5.
