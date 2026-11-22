# Admin Dashboard Plan

- **Date:** 2026-11-22
- **Status:** Implemented on `feat/admin-dashboard`, not yet deployed. Sentry and Clarity were removed from `main` in #38, so their planned fixes were dropped.
- **Goal:** Show admins every user and each user's transaction count.
- **Initial access:** Owner account only. Any user can be granted admin later.

## Open decisions

Recommended defaults, pending confirmation:

| Decision | Default |
|---|---|
| Transaction count | Non-zero rows, including settlements, imports, and reserve-linked entries |
| Admin grant | SQL only for v1, grant/revoke UI in phase 2 |
| User list | People who have used the app at least once, labeled "Joined" |

## Verify at rollout

- Production `JWT_SECRET` is set to a real value.
- Goauth's real JWT claims match `JWT_USER_CLAIM` and `JWT_EMAIL_CLAIM`.

## Authorization model

Goauth authenticates the user. Pennywise authorizes the user.

```text
Goauth JWT -> verifies user UUID
Pennywise  -> loads users.is_admin by UUID
true       -> allow /api/admin/*
false      -> 403
```

Why the role is not in the JWT:

- Revocation is immediate, with no wait for token expiry.
- Goauth needs no role storage or changes, and its API has no role support.
- Admin stays scoped to Pennywise if other apps share Goauth.
- The extra lookup runs only on low-traffic admin routes.

Move to JWT roles only if several services need centrally managed roles. Replace `is_admin` with a `user_roles` table if roles such as `support` or `viewer` are needed.

**Known limit:** Pennywise and Goauth share an HS256 secret, so anyone holding it can forge a token with an admin's UUID. Later hardening: move Goauth to RS256 or EdDSA so Pennywise only holds a public key.

## Design

| Area | Decision |
|---|---|
| Schema | `users.is_admin BOOLEAN NOT NULL DEFAULT false`, migration `0020_admin_access` |
| Identity | Match on user UUID, never email |
| Enforcement | `requireAdmin` after `ensureUser`, DB check per request, fails closed |
| Endpoint | `GET /api/admin/users?limit=50&offset=0` |
| Row fields | `user_id`, `email`, `display_name`, `joined_at`, `transaction_count` |
| Summary | Total users and total transactions across all users |
| Query | `users LEFT JOIN transactions`, so users with 0 transactions appear |
| Count rule | `amount > 0`, because opening a month creates `amount = 0` template rows |
| Ordering | `created_at DESC, id` |
| Paging | Limit `1-100`, invalid values return `400` |
| Frontend | `/admin` route, guard, and nav item shown only to admins |
| Data exposure | No amounts, categories, or individual transactions |

## Gaps and fixes

| # | Gap | Fix |
|---|---|---|
| 1 | `PUT /api/profile` accepts any email, and emails are not unique | UUID-only admin check |
| 2 | Clarity recorded production sessions | Resolved: Clarity removed in #38 |
| 3 | Repo has 3 placeholder JWT secrets: `dev-shared-secret-change-me`, `change-me`, `change-me-minimum-32-char-secret` | Treat all 3 as unsafe |
| 4 | Unmounted admin routes would fail unclearly | Keep routes mounted, return `503` when the secret is unsafe |
| 5 | Sentry could capture admin requests | Resolved: Sentry removed in #38 |
| 6 | Admin responses could be cached | `Cache-Control: no-store` |
| 7 | `/api/me` and profile endpoints share `ProfileDTO` | Return `is_admin` from all three so profile save keeps the nav |
| 8 | Summary could reflect only the current page | Separate all-users totals query |
| 9 | Pagination order can shift | Stable sort with `id` tiebreaker |
| 10 | `amount > 0` also hides zero amounts users entered | Accept it, label the column "Non-zero transactions" |
| 11 | `users` rows are created on first authenticated API call | Label as "Joined", since a true signup list needs a Goauth admin endpoint |
| 12 | Stored email can be blank if the JWT lacks the claim | Show display name, then user ID |
| 13 | Revoked admin keeps a stale nav in an open tab | On `403`, set `is_admin=false` and redirect to `/record` |
| 14 | Refreshing `/admin` could redirect before the profile loads | Guard waits for auth loading to finish |
| 15 | No record of who viewed admin data | Log admin user ID and route, never emails |
| 16 | Android uses the same page, and a wide table breaks on phones | Responsive card or row layout |
| 17 | Generated DB code must match the schema | Regenerate with sqlc `v1.31.1` |

Checked, no change needed:

- Logout and session expiry already clear cached query data.
- A `403` does not log the user out.
- The service worker does not cache API responses.

Out of scope: `ensureUser` rewrites email from the JWT on every request, so profile email edits revert. Fix separately.

## Build order

1. **Database:** add migration `0020_admin_access`, then regenerate with sqlc `v1.31.1`.
2. **Backend:** add `requireAdmin`, `GET /api/admin/users`, and `is_admin` in `/api/me` and both profile endpoints.
3. **Frontend:** add the `/admin` guard, conditional nav, responsive list, and loading, empty, and error states.
4. **Tests:** cover `401`, `403`, `503`, instant revoke, count rules, zero-transaction users, stable pagination, and profile save keeping admin.
5. **Rollout:**
   - Deploy, then get your UUID from `/api/me` while logged in.
   - Run the grant below and confirm it reports `UPDATE 1`.
   - Confirm a non-admin gets `403`.

```sql
UPDATE users SET is_admin = true WHERE id = '<your-uuid>';
```

## Phase 2

- Grant/revoke UI with audit logging and last-admin protection.
- Per-user drill-down, only with an access audit trail.
- Asymmetric JWT signing in Goauth.
