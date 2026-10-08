# Generated v1 OpenAPI contract

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/20
Primary HQ card: `t_a1bb1159` (tenant `cupmemo`). Refs #20.

`docs/openapi.json` is a deterministic, offline OpenAPI **3.1.0** document with
same-origin server `/`. It covers the ten existing coffee/brew CRUD operations,
GET `/api/v1/me`, GET `/api/v1/health`, and the four browser email/password auth
operations. It deliberately does not enumerate Better Auth's entire wildcard
transport. Operational `/health` and `/ready` exist outside this v1 document.
There is no publicly served specification route, Swagger UI, auth plugin, new
pool/auth instance, runtime serializer/validator change or deployment change.

## Supported workflow

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm api:openapi:generate
corepack pnpm api:openapi:check
corepack pnpm test
```

Generation writes only the formatted artifact. Check validates and compares exact
bytes; it never rewrites a missing/stale artifact. Both prepare the dist-only
contracts export, work without DB/auth configuration and fail on conversion or
validation errors. Root normal tests include this check, so the existing CI order
(install, format, lint, typecheck, test, build) checks committed freshness.
API typecheck additionally typechecks the offline script. There is no network
fetch, environment lookup, live data or timestamp in document construction.
All references must be local and resolve; external resolution is disabled.

Pinned development-only tooling: `@apidevtools/swagger-parser` **13.1.0** selects
its OpenAPI 3.1 schema and Ajv2020 implementation for `3.1.*` (not a 3.0-only
validator). `ajv` **8.20.0** uses its `dist/2020` entrypoint and `ajv-formats`
**3.0.1** validates document components and representative/actual responses.
Semantic checks additionally reject missing/extra operations, duplicate IDs,
unknown cookie security schemes, body-bearing 204 and required-field drift.
The tests deliberately break local refs, security, status/body and required
schemas; document validation must fail rather than silently repair fixtures.

## Source authority and projection limitations

Domain components are converted from **the same exported Zod4 schemas** that
production handlers use. Native `z.toJSONSchema` has separate raw input and
public output projections and **throws** on unsupported types; it never uses
`unrepresentable: 'any'`. Editable fields and their validators are not duplicated.
Strictness, nullability, defaults, array bounds, enums, UUIDs and numeric bounds
come from the actual exports. PATCH adds `minProperties: 1`, matching the
nonempty refinement, and has no defaults. POST defaults remain optional input;
public output requires every projected field.

The narrow adapter is pinned to Zod4.3.6:

- Numeric-to-numeric pipes retain input representation and output bounds.
- Decimal-string-to-integer query pipes retain raw strings/defaults. A regex
  derived from the output minimum/maximum enforces bounded unsigned ASCII decimal
  spelling while accepting leading zeroes. Repeated/array/unknown query values
  are rejected by the original strict object; an individual OpenAPI parameter
  cannot express an entire query object's unknown/repeated-key policy.
- The exact existing overall-score and shared-quality schema identities receive
  `multipleOf: 0.25`; these documented quarter refinements are not inferred from
  arbitrary custom functions. Overall Score /100 and Overall Impression /10 are
  independent. Zero is valid and distinct from null.
- Raw trimmed strings do not receive a misleading pre-trim `maxLength`. The
  original post-trim bounds are retained in `x-cupmemo-validation`. JSON Schema
  string lengths count Unicode code points, whereas Zod uses JavaScript UTF-16
  code units. Native output string bounds remain an approximation for astral
  characters; the original Zod output validator is authoritative.
- Incoming brew dates retain the raw offset-bearing ISO spelling; a narrow
  documented regex represents the existing transform's syntax. Output dates are
  UTC with milliseconds. Calendar validity and post-normalization year range
  remain original Zod refinements, not promises of regex equivalence.

Per-schema/operation descriptions and `x-cupmemo-validation` explicitly retain
non-machine-equivalent rules: trim-to-null, trimmed nonblank/bounds, unique-after-
trim descriptors/tags and UTF-16 sorting, valid calendar dates, finite decimal
spelling with at most two decimals, exact integer-hundredths water sum,
nondecreasing pour times within duration and contiguous output-only positions.
PATCH must validate the complete merged stored recipe inside the owner-locked
transaction. JSON Schema alone cannot enforce cross-field or database-state
invariants, and must not be used as a replacement runtime validator.
Tests demonstrate accepted JSON Schema inputs that Zod rejects for these rules,
as well as a long padded raw string that Zod accepts after trim.

## Auth provenance and security

The four auth operations are a narrow **Better Auth1.7.7 wire mirror**, grounded
in installed `api/routes/sign-up.mjs`, `sign-in.mjs`, `sign-out.mjs`,
`session.mjs`, `api/middlewares/origin-check.mjs`, `cookies/session-store.mjs`,
and the production `apps/api/src/auth.ts` configuration/transport bridge.
No live response is used to generate the document. The real HTTP harness checks
these schemas against the same production `createAuth`/`createApp`/Drizzle.
Reinspect these sources and rerun parity when upgrading Better Auth.

Handler behavior outranks incomplete metadata: sign-in's redirect is true when
a callback URL is supplied (not metadata's fixed false); user image is a nullable
string rather than an invented URI validator; unauthenticated get-session is
200 JSON null. Public library user/session fields are legitimate transport
fields, distinct from private domain storage. Password is request-only/writeOnly.
Credential field shapes have no examples or captured values. Library errors
have a message and optional code, not domain `{message}` constants; documented
statuses are applicable examples, not an exhaustive stable library catalog.
Bridge500 has its separate `Authentication request failed` envelope.

Cookie auth uses `sessionCookie`, an apiKey in cookie `better-auth.session_token`.
HTTPS production uses **`__Secure-better-auth.session_token` instead**, not two
jointly required cookies. Browser requests are same-origin with credentials
included; no bearer/JWT or client-supplied ownership. Health/signup/signin are
explicitly public; me/domain require sessionCookie. get-session and sign-out
accept optional session credentials.

Domain POST/PATCH/DELETE require exact configured Origin and deny explicit
cross-site Sec-Fetch-Site before private work. Origin is documented as a required
header without a deployment value. Private responses carry no-store and
Vary Cookie; valid application lookups never renew sessions, but targeted expired
session deletion/stale-cookie cleanup and supported Set-Cookie clears are allowed.
GET/me/domain are not claimed to be absolutely side-effect-free.

Separate library CSRF policy is intentionally not replaced by the domain rule:
signup/signin validate Origin/Referer when cookies, browser Fetch Metadata or an
Origin/Referer is present; cross-site navigation login is rejected. Sign-out
validates Origin/Referer when a Cookie header is present; without cookies it can
succeed without Origin. Missing/invalid sessions still return success/clear
cookies. Callback URLs must be trusted. get-session maintains normal seven-day
sessions/one-day sliding renewal. Its optional query flags use the pinned
`z.coerce.boolean`: any nonempty raw string, even `false`, is truthy; omit for false.

## Synthetic examples

Minimal coffee input:

```json
{ "name": "Example coffee", "roaster": "Example roaster" }
```

Output supplies null metadata and `tastingNotes: []`. PATCH `{ "country": null }`
clears only country and preserves all omissions. Empty PATCH and ownerId fail400.

Minimal brew (the synthetic coffee UUID must be owned in an actual request):

```json
{
  "coffeeId": "00000000-0000-4000-8000-000000000001",
  "brewer": "V60",
  "grinder": "Example grinder",
  "grindSetting": "6.2",
  "doseGrams": 20,
  "waterGrams": 300,
  "waterTemperatureC": 94,
  "totalBrewTimeSeconds": 180,
  "brewedAt": "2026-01-02T10:00:00+02:00",
  "overallScore": 87.25,
  "pours": [
    { "waterGrams": 60, "startTimeSeconds": 0 },
    { "waterGrams": 240, "startTimeSeconds": 45 }
  ]
}
```

Output defaults quick, all eight qualities null, tags[], notes null; adds
positions0/1 and normalizes brewedAt to `2026-01-02T08:00:00.000Z`.
Sensory mode may have none, some or all qualities. PATCH mode quick never clears
assessment; `{ "flavor": 0, "balance": null }` preserves all other values.
No score formula, intensity scale, ratio, owner, provenance or Cup Checks fields.
List queries use strings (`limit=1&offset=0`), not coerced JSON numbers. Foreign
resource IDs share the same404; foreign brew coffee filter is empty200.
Deleting a referenced coffee409 preserves history. Owned brew DELETE204 has no
content/body; after removing brews, owned coffee DELETE204 is likewise empty.

## Real verification and review

```sh
# Explicitly source your task-owned private fixture env in THIS invocation:
corepack pnpm api:openapi:test:integration
```

This opt-in command fails rather than skips without guarded test configuration.
Use a new labeled task-owned disposable PostgreSQL17.6 fixture, fixed available
loopback port and random private mode0600 environment outside version control.
Verify labels/mount/IDs, TCP readiness and authenticated database/version/role;
when the role is cupmemo, its exact fixture role/database search_path must be
public before migration. Never reset/drop/reuse a shared or production fixture.
Retain fixture/private env through independent review and owner acceptance.

The harness performs actual loopback HTTP with production wiring, validates
public responses, exercises signup/signin/session/signout/me, coffee and brew
CRUD/paging/foreign filters, quick plus sensory none/partial/full, PATCH
preservation, merged water/duration failures, 400/401/403/404/coffee409 and empty
204. Cookies/password/session response values stay in memory. Finally removes
only its exact generated users (with cascaded domain rows), verifies their
absence and closes its apps/pools/sockets. Existing DB/auth/authorization/coffee/
brew/domain and nine real Chromium E2E regressions remain separate required gates.
No UI change means no invented rendered-UI approval. Only the owner may accept,
merge, close the Issue and clean the exact retained fixture after independent
current-head technical review and CI; no production authorization is implied.
