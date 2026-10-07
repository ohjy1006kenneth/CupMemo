# Private manual coffee API

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/17
Primary HQ card: `t_5060b138` (tenant `cupmemo`).

All routes use the existing Better Auth guard and the API's same bounded Drizzle
pool. No frontend, brew CRUD, schema/migration, archive, OCR/enrichment/community,
public catalog, inventory or deployment changes are introduced.

## Routes

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/v1/coffees` | 201 `{coffee}` |
| GET | `/api/v1/coffees` | 200 `{coffees,pagination:{limit,offset,hasMore}}` |
| GET | `/api/v1/coffees/:id` | 200 `{coffee}` |
| PATCH | `/api/v1/coffees/:id` | 200 `{coffee}` |
| DELETE | `/api/v1/coffees/:id` | 204 empty body |

The explicit coffee representation contains only `id`, `name`, `roaster`,
`country`, `region`, `farmStation`, `producer`, `variety`, `process`, `elevation`,
`roastDate`, `tastingNotes`, `createdAt`, `updatedAt`. It never contains ownership,
authentication or driver fields. Timestamps are UTC ISO strings; roastDate is a
valid calendar `YYYY-MM-DD` string or null. Shared browser-safe Zod schemas and
inferred types are exported from `@cupmemo/contracts`; persistence remains
server-only. Returned projections are validated; invalid persisted output is a
service failure, not caller validation failure.

## Editable fields and bounds

POST requires trimmed, nonblank name and roaster, each at most 200 JavaScript
string code units. Nullable metadata text fields are optional, trimmed, at most
500 code units; blank strings become null. Absent metadata becomes null; no data
is guessed. Roast date is optional/null; blank or impossible dates are invalid.
Tasting notes default to `[]`: at most 32 nonblank trimmed strings of at most 100
code units, unique after trim (case-sensitive). Duplicate descriptors are
rejected, not silently deduplicated. Returned descriptors use JavaScript default
string sort: deterministic lexicographic UTF-16 code-unit order independent of
locale or PostgreSQL collation. These are roaster descriptors, not brew assessment.
Duplicate coffee names/roasters are permitted.

PATCH requires at least one editable field. Omission preserves the stored value;
null clears nullable metadata; `[]` clears descriptors. Supplied descriptors
replace the complete set, never merge. Accepted edits retain id/createdAt and
explicitly set updatedAt. Parent writes, child replacement and output validation
share one transaction; owner-filtered parent locks serialize concurrent changes.
POST parent/notes and DELETE are likewise atomic. A saved brew's non-deferrable
composite FK protects history even during concurrent brew creation: only an owned
coffee with no saved brews can be deleted. Descriptor deletion cascades; brews do
not. There is no archive feature.

Unknown body fields (including owner/id/timestamps) and wrong body types are
rejected. Path IDs must be UUIDs. List query allows only `limit` and `offset`,
nonnegative ASCII decimal integer strings; repeated values, arrays, signs,
fraction/exponent notation and unknown keys are rejected. Defaults: limit 50,
offset 0; ranges: limit 1–100, offset 0–100000. Lists use createdAt DESC, id DESC,
fetch limit+1 and a single bounded owner-joined descriptor query (no full-history
load, count query or N+1). Offset pages may shift with concurrent changes; this is
not snapshot/cursor pagination.

## Errors and privacy

All coffee responses, including parser failures, carry `Cache-Control: no-store`
and `Vary: Cookie`. Unsafe writes require the exact configured Origin and reject
cross-site Fetch Metadata before private work. Session lookups do not renew valid
sessions; the supported expired-session/stale-cookie cleanup remains unchanged.

| Status | `{message}` |
| --- | --- |
| 400 | `Invalid coffee request` |
| 401 | `Authentication required` |
| 403 | `Request origin not allowed` |
| 404 | `Resource not found` |
| 409 | `Coffee has saved brews` |
| 503 | `Coffee service unavailable` (domain/output/DB failure) |
| 503 | `Authentication unavailable` (authority dependency failure) |

Foreign and absent valid UUIDs produce identical 404s for GET/PATCH/DELETE, with
no existence probe. Only the known `brews_coffee_owner_fk` maps to 409. Unsupported
content types/body limits retain 415/413 with `Invalid coffee request`. Private
inputs, query strings, resource paths, SQL, credentials and raw parser/driver
errors are not logged. Coffee request logs redact the URL; catches emit safe
messages. The existing 900 ms connection/query/statement limits and 1500 ms auth
response deadline remain; response deadlines do not promise network cancellation.

## Isolated verification

Use a labeled task-owned disposable PostgreSQL 17 fixture with a fixed loopback
port, verified container/volume identity and strong private mode0600 environment
outside git. Do not reset/drop/shared/production databases. If the fixture role
is named `cupmemo`, configure that exact fixture role/database search_path to
`public`: PostgreSQL's default `$user` search path otherwise shadows the newly
created `cupmemo` domain namespace during the existing unqualified auth migration.
This is fixture provisioning, not a migration change.

Commands do not implicitly load env files. Source the private environment in the
same shell for EACH invocation; replace the example private path locally:

```sh
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:status)
(. /private/task/fixture.env; corepack pnpm db:test:integration)
(. /private/task/fixture.env; corepack pnpm auth:test:integration)
(. /private/task/fixture.env; corepack pnpm coffee:test:integration)
(. /private/task/fixture.env; corepack pnpm domain:test:integration)
(. /private/task/fixture.env; corepack pnpm authorization:test:integration)
corepack pnpm db:generate
```

The coffee harness fails rather than skips on missing configuration. It creates
real Better Auth A/B users/cookies, exercises production routes via injection and
actual loopback HTTP, persists across app/pool recreation, tests validation and
unchanged rejection snapshots, reciprocal IDOR, history/FK concurrency, serialized
notes, POST/PATCH rollback using uniquely named exact-owner DB instrumentation,
auth denial before tracked real domain operations, invalid projections, bounded
refused/stalled real TCP dependencies and same-pool recovery to the verified DB.
It verifies log positive controls before excluding sentinels. It removes only its
exact generated users/cascades and instrumentation in finally and drains all pools,
apps and sockets. Optional `CUPMEMO_COFFEE_TEST_LOG` writes verified sanitized
captured request logs to a fresh file (exclusive create, mode0600) for review.

With NODE_ENV unset run frozen install, format:check, lint, typecheck, test, build,
then git diff --check in that order. Root typecheck prepares dist-only contracts
and database before consumers; API build/dev/integration prepare their upstream
packages. Browser regressions additionally require the existing isolated auth
E2E fixture/config: source its private env in the same shell, unset NODE_ENV for
the Next production build, set the test's configured auth origin/API proxy and
ensure its fixed loopback ports are available. Run `corepack pnpm auth:test:e2e`
with a fresh Playwright output directory; retain previous evidence. Browser/API
auth harnesses keep development semantics so Better Auth CSRF is tested, not
bypassed by test mode. Backend-only: no UI visual approval is claimed.

Only the owner may accept/integrate after independent exact-head technical review
and current-head CI; keep the owned fixture and private env available through
review. Test success does not authorize production connections/deployment.
