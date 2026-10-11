# Reproducible isolated browser verification (Refs #27)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/27.
Primary HQ card: `t_28765bf2` (tenant `cupmemo`).

## Command and prerequisites

Use Node 24, pinned Corepack/pnpm, system `/usr/bin/chromium`, and access to the
local Docker socket `/var/run/docker.sock`. Install project dependencies first:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test:e2e:isolated
# Or choose a NEW evidence directory:
corepack pnpm test:e2e:isolated --output=test-results/my-fresh-run
```

This opt-in command does not run in ordinary root unit tests or change CI.
The existing `auth:test:e2e` remains unchanged for explicitly configured operator
fixtures, as documented in [AUTH_FRONTEND.md](AUTH_FRONTEND.md).

Run from a configuration-free shell. The runner refuses production NODE_ENV,
nonempty DATABASE_URL, CUPMEMO_DB_ENV, all three mode-specific database URLs and
CUPMEMO_TEST_DATABASE before output writes, Docker, build or network activity.
It never reads `.env`. There is no external DB/origin, keep/reuse/attach/reset,
container-name or failure-injection CLI option. Unset inherited fixture variables
rather than supplying an operator database. Child configuration is an allowlist
of tool/runtime variables plus newly generated fixture values; libpq variables,
NODE_OPTIONS preload, auth secrets and operator application settings do not pass
through. NODE_ENV is absent in build/migration children; the unchanged browser
harness starts its API with development semantics to retain CSRF checks.

An optional output must be a new descendant of repository `test-results/`.
Existing paths, files, symlinks in the path, escapes, unknown/empty/duplicate
arguments are refused. Evidence is never overwritten or removed. The default
uses a random new directory under `test-results/e2e-isolated/`. Run one instance
at a time per worktree because the existing build writes shared local artifacts.

## Isolation and execution

Every invocation creates a different cryptographic run ID, matching
`cupmemo_test_<run>` database and role, named volume and PostgreSQL **17.6**
container. Both resources carry `org.cupmemo.owner=e2e-isolated` and the exact
`org.cupmemo.run` label. Three distinct free loopback ports are chosen and checked
again before container start. A competing bind causes failure, not listener
shutdown, resource reuse or blind retry. Docker is explicitly addressed through
the local Unix socket, not an inherited Docker context or host.

DB password and Better Auth secret use 32 random bytes each. Docker receives
credentials through a private mode0600 env file in a task-private temporary
directory outside Git. Passwords are absent from argv, reports and inspect
queries. Only allowlisted formatted container/volume fields are inspected;
full Docker inspect, logs or environment dumps are not used. Child phase logs
redact generated secrets across split output chunks. Browser cookies/state remain
memory-only; existing trace/video/storage-state-file policies remain unchanged.

The lifecycle verifies exact created container ID, both labels, volume source,
mount and configured loopback endpoint before start and fresh published endpoint
after bounded TCP readiness. It then:

1. Builds the database artifact needed for the authenticated identity probe.
2. Authenticates and verifies exact current database/role, PostgreSQL 17.6
   (retaining its distribution build string separately), literal public search_path.
   Only this disposable server is configured to `search_path=public` at startup.
3. Runs existing `db:migrate` twice and `db:status`, requiring current 3/3.
4. Runs unchanged `auth:test:e2e --output=<fresh browser subdirectory>`: production
   workspace build followed by all **81 baseline browser flows**. The one existing
   harness owns Fastify and Playwright owns Next; the runner launches neither.
   Generated BETTER_AUTH_URL and CUPMEMO_API_ORIGIN match before build.

The report includes candidate Git commit/tree, phase status/exit codes,
nonsecret fixture identity/ownership, endpoints, identity probe, browser output,
cleanup outcomes and overall exit code. Logs, explicit screenshots and numeric
browser measurements remain in the new output directory. A list of tests is
coverage inventory, not proof of executed assertions. A full run must report 81
passed and exit zero; fewer tests, failed checks or cleanup cannot count as PASS.

## Critical coverage map: existing assertions, not duplicate tests

All flow helpers are registered by `tests/e2e/auth.spec.mjs`, using the same real
Next/Fastify/PostgreSQL harness. Source ranges below locate actual assertions;
parameterized titles expand in Playwright's list and real execution log.

| Requirement | Existing title and assertions |
| --- | --- |
| Signup/signin/signout | `real signup, persistence, signin, signout, revocation and back navigation` (`auth.spec.mjs:116–162`): real form signup, reload/fresh context, HttpOnly/Lax cookies in memory, signout revocation visible in second context, server HTML excludes tokens/cookies. |
| Auth failure/expiry | `expired and DB-revoked sessions redirect without account content`, `wrong credentials and duplicate signup are generic; failed revocation and real outage are retryable` (`auth.spec.mjs:196–295`): actual owned session expiry/deletion, generic denial, real API outage. The failed-revocation interception is a simulation. |
| Manual prerequisite and overall-only quick save | `brew real manual prerequisite, overall-only save, latest second brew, optional zero quarters and durable Journal` (`brew-flows.mjs:75–163`): empty chooser, real manual coffee form, one POST/one row, overall87.25 with null qualities, second new ID, zero/quarter persistence, fresh signin and Journal reload. |
| Optional sensory/shared values | `sensory real new none/partial/full qualities shares mode/back and persists one POST with blank latest assessment` (`sensory-flows.mjs:80–160`): blank overall/no inherited assessment, same mode/back values, independent overall0, optional null versus zero/all8 values, hidden quick-mode retention, actual POST and reopened fresh signin. |
| Paged history and detail | `history real initial action and >20 tied-date pages preserve actual API order and later-empty Previous` and `history real detail overall-only null and zero/full8 custom quick retained and coffee context` (`history-flows.mjs:76–172`): real21 entries, bounded20+1 pages/API ID order, later-empty Previous; bound real coffee context and actual null/zero/all8 detail. |
| Same-ID saved recipe/tasting | `history real both-panel recipe pours date and assessment save same ID then fresh signin/detail` (`history-flows.mjs:173–225`): exact changed-only PATCH, same ID/coffeeId/createdAt, count1/no POST, fresh signin/readback; timestamp/concurrent omitted-field preservation follows at227–258. `sensory real Journal edit no-op changed-only PATCH preserves concurrent recipe and all immutable identity` (`sensory-flows.mjs:161–217`) proves no-op/no PATCH and hidden-value retention. |
| Cancel/validation/refusal | `history real both-panel hidden invalid focus cancellation/refusal/reopen never POSTs` (`history-flows.mjs:259–291`): pour mismatch and hidden quality focus, decline/accept native discard, zero writes, authoritative unchanged reopen. `brew native draft warnings, cancel decline/accept, reload reset and no write/replay` (`brew-flows.mjs:322–354`) covers new drafts. |
| Uncertain writes/outage | `brew real owned API outage after mounted validated recipe settles is uncertain and never replays`, `sensory real API outage after validated saved readiness retains uncertain lock and fresh Journal recovers`, `history real owned outage after settled detail then recipe uncertain and fresh read recovery`: stop only harness-owned API, visible uncertain lock, no replay, deliberate fresh-read recovery. |
| Two-user ownership | `brew real cross-account selection privacy, foreign POST404, and new mounted draft does not leak` (`brew-flows.mjs:226–271`), `sensory real two-user deep link GET/PATCH foreign and missing404 no exposure; invalid ID no lookup` (`sensory-flows.mjs:311–343`), `history real two-user history/detail absent-or-foreign404 and invalid route no lookup` (`history-flows.mjs:292–317`): real accounts/ownership denials, hidden private content, invalid route no lookup; no happy/ownership mocks. |
| PWA online-only boundary | All3 titles in `pwa-flows.mjs:5–139`: anonymous manifest/icons/metadata/installability diagnostics; offline fresh private navigation failure/no private caches; offline save uncertainty/no queue/replay, empty actual server collection after reconnect. Incognito exception is explicit, not native installation PASS. |
| Labeled fault simulations | `brew LABELED controlled write fault ...`, `sensory LABELED PATCH fault ...`, `sensory LABELED body-stalled PATCH ...`, `history LABELED GET ...`, `history LABELED recipe PATCH ...`, `manual LABELED POST fault simulation ...`, shell controlled collection faults. These intercept errors/malformed/stalled responses to assert declined/uncertain/deadline/late-response policy, never substitute real happy/auth/ownership success. |

The unchanged tests retain workers1, retries/defaults, 45s test deadlines and10s
expect deadlines. Responsive desktop-browser viewports are not physical devices.
This command is not a fresh independent visual/UX audit, native installation test,
physical Android/iOS test, screen-reader audit, public HTTPS/deployment check,
release audit or comprehensive security review. Those remain UNVERIFIED here;
#29 and human-gated deployment work remain separate outcomes.

## Cleanup, failure and interruption

Success, phase failure, SIGINT and SIGTERM drain only owned subprocess groups,
close identity pools and re-read exact ownership before removing the created
container by ID and its exact volume. Container absence is recorded, never
silently treated as a fresh ownership assertion. Volume/ownership mismatch or
cleanup failure refuses deletion and makes the overall result nonzero while
retaining the original failed phase. Ports are checked after cleanup. Private
files are removed independently even when resource deletion is refused.

SIGKILL, power loss and process/runtime crash can bypass finally. Do not infer
cleanup from missing logs. Preserve the report and recover only after manually
checking its exact run, IDs and endpoint. Example allowlisted queries (replace
placeholders with the nonsecret IDs from YOUR report, not another run):

```sh
docker --host unix:///var/run/docker.sock container inspect --format \
  '{{.Id}} {{.Name}} {{json .Config.Labels}} {{json .Mounts}} {{json .HostConfig.PortBindings}}' <exact-container-id>
docker --host unix:///var/run/docker.sock volume inspect --format \
  '{{.Name}} {{json .Labels}} {{.Mountpoint}} {{.Driver}}' <exact-volume-name>
```

Compare the container ID/name, owner/run labels, mount name/source/destination,
volume mountpoint and loopback binding against the report. If any mismatch,
STOP; do not delete. First stop only demonstrably owned surviving process groups
and close their connections. Only after these checks may the operator remove
that exact container ID, re-read the exact volume identity and remove that exact
volume. Never prune, wildcard-delete, broad pkill, drop/reset a database, stop a
competing listener or use global Compose down. Any residual private temporary
files require exact task-owned path verification before removal; never attach
them. Docker daemon access itself is privileged; this runner is not a sandbox
against another actor changing resources between inspect and remove.

For acceptance run fresh artifact-free quality gates in CI order, then this full
command twice sequentially at different outputs, and independently exercise
refusal, real failing child and SIGTERM lifecycle probes. Unit subprocess mocks
are deterministic lifecycle coverage, not Docker/E2E evidence. Independent
exact-head technical review must perform another complete fresh-fixture run and
inspect credential/lifecycle safety. Only the owner integrates, verifies the
merged tree, closes #27 and completes the same primary card.
