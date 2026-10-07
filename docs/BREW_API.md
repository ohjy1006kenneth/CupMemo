# Private transactional brew API

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/18
Primary HQ card: `t_584da139` (tenant `cupmemo`). Refs #18.

Backend-only: production Fastify routes share the existing Drizzle pool and Better
Auth guard. No schema/migrations, UI, production deployment, expanded sensory
input (#19), archive, provenance/copy endpoint or OpenAPI generator (#20).

## Routes and representation

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/v1/brews` | 201 `{brew}` |
| GET | `/api/v1/brews` | 200 `{brews,pagination:{limit,offset,hasMore}}` |
| GET | `/api/v1/brews/:id` | 200 `{brew}` |
| PATCH | `/api/v1/brews/:id` | 200 `{brew}` |
| DELETE | `/api/v1/brews/:id` | 204 empty body |

The explicit flat public representation contains exactly:
`id,coffeeId,brewer,grinder,grindSetting,doseGrams,waterGrams,waterTemperatureC,totalBrewTimeSeconds,brewedAt,overallScore,tastingMode,acidity,body,aftertaste,tastingTags,notes,pours,createdAt,updatedAt`.
IDs are UUIDs, numbers are JSON numbers (not PostgreSQL numeric strings), and dates
are normalized UTC ISO strings with milliseconds. No owner/auth/hidden sensory
columns, ratio, cumulative water or provenance. Contracts and inferred types are
browser-safe `@cupmemo/contracts` exports, independent of persistence. Every
response is validated; corrupt stored output fails 503 rather than being repaired.

## Inputs, units and bounds

POST requires coffeeId, brewer, grinder, grindSetting, doseGrams, waterGrams,
waterTemperatureC, totalBrewTimeSeconds, brewedAt, overallScore and pours. Recipe
text is trimmed nonblank, max200 JavaScript code units; grinder notation is text,
not a coerced number. Dose/water and each incremental pour are finite positive
JSON numbers <=99999.99 with at most two decimal places, checked before database
rounding. Temperature is Celsius, 0..100, max2 decimals. Duration and start times
are integer seconds, 0..86400. Ordinary 0.1/0.29 decimals are accepted without
binary floating-point artifacts; sum comparison uses validated integer hundredths,
not an epsilon allowance for mismatched water totals.

brewedAt is explicit ISO calendar/time with Z or a numeric offset, at most3
fractional digits, valid years0001..9999 including after UTC normalization. Invalid
calendar dates, missing offsets, overflow and excessive precision are rejected.
There is no implicit now or invented restriction on past/future brews. Server
controls createdAt/updatedAt.

Overall score is required, independent /100, 0..100 in quarter points. Optional
acidity/body/aftertaste are nullable /10, 0..10 in quarter points. Omission defaults
to null and zero remains a valid score. Optional notes trim to null when blank,
max5000 code units; optional tags default to[], max32 distinct trimmed nonblank
strings max100, case-sensitive. Duplicates after trimming are rejected. Output
tags use JavaScript default UTF-16 lexical sort, not database collation. No score
or example assessment is seeded. POST stores tastingMode quick; stored sensory
mode may be returned, but #18 does not accept mode switching or expanded attributes.

Pours are 1..32 strict `{waterGrams,startTimeSeconds}` objects. Array order assigns
contiguous zero-based positions; output adds position. Client positions, child
IDs and cumulative values are refused. Starts must be nondecreasing (equal is
allowed), first need not0, each <=duration, and exact incremental sum must match
waterGrams. Total duration includes drawdown; last start need not equal duration.
No automatic schedule/total repair. Ratio and cumulative targets are derived.

PATCH requires at least1 editable field from POST except coffeeId. It rejects
unknown fields, owner/ID/timestamps, mode, expanded attributes and immutable coffee
association even if unchanged. Omission preserves; null clears nullable values;
[] clears tags; supplied pours replace the entire nonempty schedule. Inside the
same owner-locked transaction, validate existing output first, merge the partial
input with the complete stored recipe, validate all invariants BEFORE mutation.
Water-only mismatch or shortened duration below a retained start is400, with no
parent/timestamp/child change. Invalid existing state is503, not caller400.
Successful edits preserve ID/createdAt/coffeeId/count, explicitly update updatedAt,
and preserve hidden expanded sensory columns and stored mode. A recipe sent to
ordinary POST creates a NEW ID; no separate copy endpoint.

DELETE permanently removes only the owned brew and cascading pours/tags. Coffee,
other brews and other owners survive. Coffee deletion remains409 while a brew
references it; after the last brew is removed the normal coffee route may delete
it. This is application deletion, not production/reset authority.

## Ownership, transactions and pagination

Every private parent SELECT/UPDATE/DELETE uses ownerScope/ownedResourceScope in
SQL. No fetch-by-ID-then-JavaScript ownership comparison or existence probe. POST
locks the owned coffee in the same transaction as parent/children/output; the
composite coffee/owner FK additionally protects association and coffee history.
GET/PATCH/DELETE lock the owner-scoped parent; PATCH writes and complete child
replacements are atomic. Child reads use owner-joined SQL, and replacements are
authorized by that same locked owned parent. Output validation is inside the write
transaction. Parallel patches serialize to complete submitted states, never mixed
child sets. Expanded sensory fields are not rewritten by quick/recipe edits.

Strict collection query accepts only optional coffeeId UUID, limit and offset.
Pagination values are unsigned ASCII decimal strings; defaults50/0, ranges1..100
and0..100000. Repeated/array/sign/exponent/fraction/unknown values are invalid.
Foreign/absent coffee filters both yield empty200 without probing coffees.
Order is brewedAt DESC, id DESC. Fetch limit+1 for hasMore, and bounded batched
owner-joined pours/tags for the selected page; no count, full-history load or N+1.
Selected parents have shared locks during child projection to avoid torn schedules.
Offset pages are not a snapshot and may shift with concurrent insert/delete/edit.
coffeeId plus limit1 supports future latest-recipe retrieval.

## Errors and runtime privacy

All brew responses, including parser errors, have no-store and Vary Cookie.
Unmatched brew-namespace paths and unsupported methods return generic404
`Resource not found` before Fastify's default URL-echoing response/log handler.
Malformed URL components return generic400 `Invalid brew request` at the router
boundary, before route hooks can run. Neither boundary reflects method, path,
resource ID or query. These boundaries do not change unrelated routing/errors.
Missing/foreign valid UUID GET/PATCH/DELETE and missing/foreign POST coffee return
identical404 `{message:'Resource not found'}`. Invalid UUID/input/query/merged
recipe returns400 `Invalid brew request`. Parser failures preserve413/415 with
that same sanitized message. Domain/database/output failure is503
`Brew service unavailable`. Guard behavior remains401 `Authentication required`,
403 `Request origin not allowed`,503 `Authentication unavailable`.

Unsafe writes require exact configured Origin and reject cross-site Fetch
Metadata. Denials precede domain work. Valid-session checks do not renew; allowed
targeted expired-session deletion/stale-cookie cleanup and normal browser renewal
remain unchanged. Production retains900ms pool connection/query/statement bounds
and1500ms authority response deadline; deadlines are not cancellation promises.
No new pool, auth instance, environment fault flag or production test hook.

Brew request URLs/queries are redacted in structured logs. Raw private input,
SQL, resource IDs, cookies/tokens and parser/driver errors are not logged. Actual
request-event positive controls precede sentinel-exclusion assertions. Regression
checks include unsupported methods, unmatched subpaths and malformed URL components
through both injection and actual HTTP, with real captured-log exclusions.

## Isolated real verification

`corepack pnpm brew:test:integration` prepares upstream packages and runs the real
production app/Drizzle/Better Auth A/B harness; absent/invalid prerequisites FAIL,
never skip. Provision only a labeled task-owned disposable postgres17.6
container/volume on a verified fixed loopback port, with random mode0600 private
env outside git. Verify labels, IDs, mount, TCP readiness and authenticated DB
identity. If the role is cupmemo, set that exact role/database search_path public
to avoid auth migration namespace shadowing. No shared/prod/reset/drop database.
Keep fixture/env available for independent review and exact owner cleanup.

Source the private environment in the SAME shell for EACH invocation:

```sh
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:status)
(. /private/task/fixture.env; corepack pnpm db:test:integration)
(. /private/task/fixture.env; corepack pnpm auth:test:integration)
(. /private/task/fixture.env; corepack pnpm coffee:test:integration)
(. /private/task/fixture.env; corepack pnpm brew:test:integration)
(. /private/task/fixture.env; corepack pnpm domain:test:integration)
(. /private/task/fixture.env; corepack pnpm authorization:test:integration)
corepack pnpm db:generate
```

The brew harness exercises injection plus actual loopback HTTP and app/pool
recreation; quick/null/zero/full assessments, copy/edit/delete/history, tied paging,
reciprocal IDOR and association, unchanged validation snapshots, merged patches,
hidden sensory preservation, complete concurrent schedules/tags, FK deletion
race, and actual post-parent child/projection rollback. Exact generated-owner PG
instrumentation is removed in finally, alongside exact generated users and all
apps/pools/sockets. It tests denied real sessions/origins before tracked domain
work, real refused/stalled TCP authority/domain failures, queue/drain bounds and
same-pool recovery. `CUPMEMO_BREW_TEST_LOG` optionally saves verified sanitized
request logs to a NEW file (exclusive create, mode0600), never raw diagnostics.

Ordinary root tests exercise pure strict contracts and production route boundary.
Run fresh artifact-free exact-candidate frozen install, format:check, lint,
typecheck, test, build and git diff --check in CI order with NODE_ENV unset.
Existing auth Chromium E2E additionally needs the test's origins/API proxy and
available3314/4314 ports, NODE_ENV unset for Next production build, separate fresh
Playwright output directory; do not destroy prior evidence. No frontend change
means no UI visual gate is claimed. Deeper independent exact-head technical
review is required for authenticated writes/deletes, IDOR, transactional rollback,
association race and multirow validation; only the owner accepts/integrates.
