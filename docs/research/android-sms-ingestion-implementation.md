# SMS ingestion: phases 1–3 implementation and contracts

This document records the phases 1–3 ingestion milestone. [Phase 4](android-sms-phase4.md) supersedes its processing-availability/state descriptions: the backend now has an optional two-stage SMS AI worker and separate draft table, disabled by default. The ingestion fingerprint, queue/checkpoint and authentication contracts below remain applicable.

## Scope and remaining gates

Implemented: backend durable ingestion, device credentials/consent, global sender configuration, native manual scanning, Room queue/checkpoints, upload retry, opt-out, and web device-token management. `sms_suggestions` is the backend queue. There is **no SMS AI worker**, suggestion approval API/UI, daily timer, or foreground scan trigger yet. The existing natural-language transaction parser is unrelated and unchanged.

Phase 1 is not fully signed off: Android emulator verification does not establish `READ_SMS` availability on the owner's real phone/installer. Exact classifier/extractor identities, data handling, and model fixtures await the owner's phase-4 inputs. Do not represent those provider checks as completed.

## Setup

1. Start the backend normally; migration `0016_sms_ingestion` runs through the existing migration path.
2. Populate the global sender list as a database maintainer. It starts empty (no uploads). Use exact normalized full IDs, not bank-family substrings:

   ```sql
   BEGIN;
   UPDATE sms_sender_config
   SET senders = ARRAY['AD-ICICIB'], version = version + 1, updated_at = now()
   WHERE id = true;
   -- Cancel pending jobs for newly removed senders, without deleting fingerprints.
   UPDATE sms_suggestions
   SET status = 'cancelled', body = NULL, sender = NULL, received_at = NULL, updated_at = now()
   WHERE status IN ('queued', 'classified', 'uncertain')
     AND NOT (sender = ANY ((SELECT senders FROM sms_sender_config WHERE id = true)::text[]));
   COMMIT;
   ```

   Maintain entries using uppercase ASCII and trimmed whitespace. Increment the version for every change. The endpoint is read-only; there is no ordinary-user allowlist editor. Adding a sender does not reset checkpoints or automatically scan history.
3. In web Settings → Android SMS import, create a named device token. It is displayed once, stored only as a SHA-256 digest server-side, and can be revoked from the same screen.
4. Build/install Android using `android/README.md`. Open the native **Android SMS settings** button, paste the token, connect, read the disclosure, enable, grant `READ_SMS`, and tap **Scan now**. Connect requires network and caches the initial sender configuration. No SMS is scanned merely by connecting or enabling.
5. First activation scans from the start of today in the phone's timezone. Later manual scans catch up one day per invocation with a six-hour overlap. A scan is capped at 5,000 provider rows and 8 MiB of matching UTF-8 payloads; an oversized range fails without advancing the checkpoint. A historical-range picker is not implemented yet.
6. After disable/re-enable, scanning starts at re-enablement, not during the disabled interval. To replace a token/account, disable and wait for backend cancellation first. Replacing the token clears the local account's queue/checkpoints.

The native device token is independent of the WebView's browser login. Logging out of web does not revoke a device token; explicitly disable native import or revoke it in web Settings when changing ownership/accounts. No SMS bridge or browser-cookie copying was added.

## Authentication and consent

Web JWT endpoints (normal authenticated session):

- `GET /api/sms/devices`: metadata only, scoped to the signed-in owner.
- `POST /api/sms/devices` with `{ "label": "My phone" }`: returns `{ "device": ..., "token": "sms_..." }` once. At most 10 active credentials per account; new devices are disabled.
- `DELETE /api/sms/devices/{id}`: revoke, fence consent, cancel/purge unprocessed payloads for that device.

Opaque device-token endpoints (`Authorization: Bearer sms_<64 hex characters>`):

- `GET /api/sms/device/session`: account/device identity, enabled state, consent version, sync metadata.
- `GET /api/sms/device/senders`: `{ "version": 1, "senders": [] }`.
- `PUT /api/sms/device/consent`: `{ "enabled": true, "expected_version": 1 }`; returns updated session. Stale versions return 409. Repeated disable advances the version to fence in-flight enables. Uploads require the current enabled consent version.
- `POST /api/sms/device/uploads`: durable message acceptance / sync coverage, below.

Device tokens cannot read or write ledger transactions, list suggestions, create/revoke credentials, or edit configuration. Browser JWTs cannot act as device tokens. Device-row locking serializes uploads, revocation, and consent updates; this is not an AI claim transaction.

Android persists opt-out before cancelling scan work, fences queue commits using a local generation, purges unsent payloads, and schedules persistent control work to propagate cancellation. A pending offline cancellation blocks re-enable/token replacement. Pending cancellation is reconciled on app startup if the process died before enqueueing control work. Already-transmitted requests cannot be recalled.

## Fingerprint and upload contract

Version 1 normalization: trim only surrounding ASCII space/tab/CR/LF; uppercase ASCII letters only. Allowed sender IDs contain 1–80 printable ASCII characters, excluding `|` and whitespace. Match the complete normalized sender string.

```text
fingerprint = lowercase_hex(SHA256(UTF8("v1|" + sender + "|" + received_at_ms + "|" + exact_body)))
```

Sender cannot contain `|`, timestamp is a decimal integer, and body is the last field. Body text is not trimmed or normalized. Timestamp must be Unix milliseconds between 2000-01-01 and five minutes ahead of server time. Hashing is deduplication, **not anonymization or a cryptographic guarantee that message content cannot be guessed**. A restore that changes the timestamp can evade this fingerprint.

```json
{
  "consent_version": 2,
  "allowlist_version": 3,
  "messages": [
    {
      "fingerprint_version": 1,
      "fingerprint": "<64 lowercase hex characters>",
      "sender": "AD-ICICIB",
      "received_at": 1792800000000,
      "body": "<exact SMS body>"
    }
  ]
}
```

- Maximum 100 messages/request, 16 KiB UTF-8/message body, 2 MiB request, 5,000 outstanding rows/device. Backend verifies every fingerprint and validates the entire batch before committing.
- Server uses the current global allowlist, not the client's version. Nonmatching senders receive a terminal `sender_not_allowed` receipt without storing their payload or creating a job.
- Unique `(user_id, fingerprint_version, fingerprint)` inserts happen before any AI work. Conflicts return the original row ID/status without resetting it, even if cancelled or failed.
- Response: `{ "receipts": [{ "fingerprint": "...", "id": "uuid-or-null", "status": "queued-or-existing-status" }], "allowlist_version": 3 }`.
- Android validates complete acknowledgement before clearing local payloads. The acknowledged fingerprint remains locally as a tombstone; a failed/ambiguous response retries the same fingerprint.
- Report `scan_end` in a separate empty-message upload **only after the pending queue is drained and there are no locally expired, unacknowledged messages**. Expiration is not an upload acknowledgement: Android warns and withholds complete-coverage claims until an explicit new capture boundary (disable/re-enable or token replacement). This also reports a genuinely empty scan. Backend stores monotonically increasing scan coverage separately from last contact; a new contact alone is not proof of complete coverage.
- A queued row is durable acceptance, not proof of successful AI processing. No SMS AI calls are made in this release.

## Local persistence and recovery

Room tables:

- `sms_queue`: account + fingerprint primary key; transient sender/body, received timestamp, queued timestamp, config version, attempts, acknowledgement/expiration flags, backend ID.
- `sms_scan_state`: account-scoped committed scan end.

The single `sms-scan` WorkManager job (`KEEP`) owns scanning/uploading. Local entries stay pending until acknowledgement; there is no separately persisted `uploading` lease to strand after a crash. Queue inserts and checkpoint advancement use one SQLite transaction, with a final opt-in generation check under the same in-process lock as settings changes. Nonmatching bodies are not accessed/copied from the cursor by app code.

Manual work retries with exponential backoff (five automatic failure retries, then Scan now can retry). A fresh scan failure does not prevent an attempt to upload older queued messages. Scanning can queue offline using cached configuration; an unknown configuration fails closed. One run uploads at most ten batches of 50 and retries a remaining backlog. There is no network constraint on the scan itself, since offline queueing is useful. HTTP requests have timeouts, reject redirects, and use the build-time app origin, not a user-controlled upload destination.

On clock rollback, scan today's range without moving the saved high-water mark backwards. Historical restores outside the overlap still require a future explicit historical-rescan feature.

## Privacy and retention

- Raw SMS never appears in URLs, logs, analytics events, debug exports, or application error messages. The web token field is masked for Clarity; native settings block screenshots.
- Native device token is encrypted with an Android Keystore AES-GCM key. Database, preferences, files, and device transfer are excluded from Android backup; private SQLite relies on the device's platform storage protection, not SQLCipher.
- Acknowledgement clears local sender/body/timestamp. Opt-out purges unsent payloads. Local unsent payloads expire after seven days, evaluated when scan work next runs; fingerprints remain to prevent automatic re-upload.
- Backend maintenance runs at startup/hourly, clears raw payloads older than seven days, and cancels expired unprocessed rows. This runs even while SMS AI is absent. Database/platform backups need their own retention and access controls; row cleanup is not backup erasure.
- Cancellation clears raw payloads for queued/classified/uncertain rows. Existing approved/reviewable data is not silently deleted by token revocation.

## Verification and handoff

Automated checks cover backend ingestion/auth isolation/concurrent deduplication/cancellation/retention, shared Kotlin/Go fingerprint vectors, web token management, and SQLite transaction rollback/deduplication on an Android emulator. Emulator instrumentation exercises Room and native Settings defaults/privacy; it does not establish real bank-SMS access on the owner's phone. Physical-phone permission access and real installer behavior remain a manual gate. Phase 4 should consume only committed queued rows, recheck consent + current global sender eligibility, and preserve all existing deduplication and cancellation contracts.

Implementation verification:

- Backend SMS integration tests pass with the race detector against a disposable PostgreSQL database; `go test ./...` without integration configuration and `go vet ./...` pass.
- The broader PostgreSQL integration suite still fails `TestArchivedReserveSpendingCannotBeDeleted`; the same failure was reproduced from unchanged `HEAD` in a separate disposable database. No reserve code was changed.
- All 340 web tests pass using `NODE_OPTIONS=--no-experimental-webstorage npm test` on this Node installation. Without that flag, an existing auth test collides with Node's unconfigured experimental `localStorage`. Production web build and focused SMS ESLint checks pass.
- Android JVM tests, three instrumentation tests on Pixel 8 / API 35, debug APK build, and Android lint pass (lint retains warnings, not errors).
- Global sender configuration is empty by default and no production SMS was read or uploaded. Populate the list and perform the physical-phone smoke test before relying on the feature.
