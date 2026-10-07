# Authentication frontend (Refs #14)

Primary HQ card: `t_18671053`. Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/14.

## Implemented boundary

`/` redirects to `/sign-in` or `/app`. `/sign-in` and `/sign-up` redirect signed-in visitors to `/app`. `/app` is a protected account landing, not a brew home or app shell. Brew features, email verification/reset delivery, OAuth, installability and offline support are not implemented by this outcome.

Fastify alone owns Better Auth and PostgreSQL. Forms use the official pinned Better Auth 1.7.7 React client with `basePath: '/api/v1/auth'` and an explicit browser `window.location.origin` base URL, avoiding public auth URL environment overrides. The pinned client appends the base path to that origin (a relative `baseURL` throws). Client instantiation during SSR performs no request. Browser requests use cookies through the existing same-origin Next rewrite; no public API environment variable, bearer identity, browser storage identity, Next auth handler or extra database pool is added.

Every server gate forwards incoming cookies only to the validated server-only `CUPMEMO_API_ORIGIN`, at the fixed `/api/v1/auth/get-session?disableRefresh=true&disableCookieCache=true` path. Gates are dynamic, use `no-store`, a three-second deadline and manual redirect handling. Missing cookies and actual 401/null sessions are unauthenticated; upstream failures, timeout, redirects and malformed responses instead show a retryable unavailable state. Only benign name/email fields leave the boundary; only the display name is rendered. Tokens, session objects and cookies never enter RSC props.

The per-request `disableRefresh` branch in Better Auth 1.7.7 suppresses renewal for valid server checks. This is non-renewing validation, not a claim of absolutely side-effect-free reads: the unchanged library can delete expired sessions/clear cookies before that branch. Next server components cannot forward those cookie updates. Global session renewal remains unchanged (seven-day sessions, one-day update age, no cookie cache). The mounted official `useSession` client on `/app` performs a normal same-origin session request, so renewal `Set-Cookie` reaches the browser. Its pending/null/error state hides stale account content; null redirects, errors remain retryable. Official visibility/cross-tab refresh plus a persisted `pageshow` recheck cover returning to existing client state. These are freshness checks, not a replacement for the server gate.

Sign-out waits for successful Fastify revocation before fixed `/sign-in` navigation and a router refresh. Failure does not pretend to revoke. Passwords are never logged or stored, are masked in the form and cleared on success. All redirects are constant routes. Inline validation retains native validity rules (8–128-character passwords, matching pinned defaults), visible labels, error descriptions, focus management and pending announcements.

The server boundary structurally validates the pinned 1.7.7 session/user JSON contract before projecting display fields: nonempty IDs and token, matching session `userId`/user `id`, canonical serialized dates (including expiry), user name/email/verification types and optional nullable string fields. Empty, incomplete, mismatched or malformed non-null records return unavailable. This checks response integrity only; Fastify remains the authority for authentication, expiry and revocation. The private fields are neither returned nor logged.

## Local checks

Root unit tests are database-independent. Vitest has a test-only empty `server-only` shim; production keeps the real package's server-component guard. React DOM tests use root-local dependencies so pnpm's strict package resolution does not depend on hoisting.

The opt-in real browser command uses pinned `@playwright/test` 1.63.0 and `/usr/bin/chromium`. Install Chromium using the host's supported package manager if it is absent; no browser download or global Playwright installation is needed on the verified host.

Before each invocation, explicitly export a private task-owned configuration (never commit it). Required configuration:

- `CUPMEMO_DB_ENV=test`, `CUPMEMO_TEST_DATABASE=cupmemo_test_<task>` and the matching private `CUPMEMO_DATABASE_URL_TEST`, on a trusted disposable loopback PostgreSQL 17 instance.
- Private strong `BETTER_AUTH_SECRET` (at least 32 random characters).
- `BETTER_AUTH_URL=http://127.0.0.1:3314` and `CUPMEMO_API_ORIGIN=http://127.0.0.1:4314`.
- Ports 3314/4314 must be free. Existing servers are never reused/stopped.
- Do not set `NODE_ENV=production` for the database/API fixture. Next performs a production web build/start independently; the API fixture deliberately uses development semantics so CSRF checks are exercised rather than Better Auth's test-mode bypass.

After exporting that configuration:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate
corepack pnpm auth:test:integration
corepack pnpm auth:test:e2e
```

`auth:test:e2e` builds the actual workspace before starting Next and the task-owned Fastify child. It fails if configuration, DB, browser, build or ports are unavailable; it never silently skips or substitutes mock auth. Tests create unique fixture accounts, age/expire/delete only those accounts' sessions, stop/restart only their own API child to exercise a real outage, and delete their fixture accounts/close processes and pools at completion. They never reset/drop a database. Preserve the task-owned PostgreSQL fixture for independent review; removal is a separate operator decision.

Coverage includes real signup/signin/signout, wrong credentials and duplicate creation, HttpOnly/Lax cookie persistence, fresh browser contexts, server-only non-renewal versus mounted-client DB AND cookie renewal, expired/revoked sessions, back navigation, actual API outage/retry and keyboard completion at 320/360/390/430/1280px. Screenshots under ignored `test-results/` contain synthetic display names/invalid input only. Traces, video and file-backed auth storage state are disabled; do not attach cookie snapshots or raw auth responses as evidence. Expected connection-refused diagnostics during the intentional outage are not product-facing error messages.

Technical review, rendered visual review, owner acceptance and deployment authorization remain separate gates on the same primary card.
