# Pinned AppManagement Syncthing admission source

This is a source distribution and hosted build procedure, not an installed
manager or permission to launch PostgreSQL. It extends the accepted source-only
checkpoint (coder3361 / independent3362 / owner3363) on primary hq/t_9cbb487a,
[Issue11](https://github.com/ohjy1006kenneth/CupMemo/issues/11). Original implementer
is `code-monkey-cupmemo`, integer original implementation run **2817**; current
publication revision **3369**, owner scope **3368**. `source-lock.json` binds original inputs, modules,
cumulative patch, authoritative helper and service tests. It does not assert a
compiled or live PASS. Actual build identities/results reside in the exact-head
Actions artifact and same-card native evidence, not guessed binary hashes.

## What is distributed

- Full upstream revision `cc80b3313113d946f7216ff4b95c3c4b83381149`, fetched only
  by the bounded hosted reproduction script and verified against locked bytes/hash.
- Four minimal ORIGINAL affected Go files plus upstream LICENSE, solely for offline
  patch regression. They are not a runnable manager. No applicable upstream NOTICE
  was present in the pinned source.
- A cumulative patch modifying those real service/routes and adding
  `service/syncthing_policy.go`, actual package tests and the authoritative
  `service/testdata/syncthing-manager-policy.mjs`. There is no second active helper.
- Read-only `materialize.py` source acquisition checks (writes only its explicit
  new fixture directory); `hosted-build.py` runs only on GitHub-hosted ARM64.

The single Node helper adds only four legacy operation names. CURRENT comes from the resolved model,
not the request id. Protected name `local-syncthing`, canonical component-below
working/compose path, or service `big-bear-syncthing` in CURRENT or effective
CANDIDATE refuses synchronously. Prefix siblings remain ordinary. Existing
SetStatus/read/list bodies are not rewritten or declared approved. Private Go
injection seams bind real production dependencies in public methods; they add no
exported unsafe constructor, mutable global hook or environment/CLI bypass.

Production transport remains fixed `/usr/bin/node` and
`/usr/local/lib/cupmemo/syncthing-manager-policy.mjs`, a trusted root-owned,
nonwritable ancestry and single-link regular helper, 3-second context,
250ms WaitDelay, independent 64KiB stdout/stderr caps without promoted ReadFrom,
minimal environment and exact allow bytes. It is not a root sandbox: root can
replace trusted paths. Policy paths are lexical, not proof against deployment
aliases/mounts. No raw request/helper output is returned in policy errors.

## Reproduction and evidence

Safe local offline distribution check (no network, Go, Docker, database or NAS):

```sh
corepack pnpm exec vitest run tests/casaos-appmanagement-source.test.mjs --maxWorkers=1 --no-file-parallelism
```

Only `.github/workflows/appmanagement-guard.yml` is the heavy build lane. Do not
run the hosted script or Go toolchain on the Pi. It checks out actual PR head
(not synthetic merge SHA), records head/tree/event/run/attempt and verifies
locked source, official Go1.26.9 and compatible MessageBus schema. Real pinned
`oapi-codegen@v1.12.4` generates both missing APIs; original go.mod/go.sum stay
byte-identical with `-mod=readonly`. No go generate/main-schema download, stubs,
module replacements or compiler fallback are used.

Pinned official Node24.15.0 bookworm index and ARM64 child identities are checked.
Every Go/codegen/gofmt/test process runs inside task-owned disposable containers:
3GiB memory and swap-total (zero swap), 2CPU, pids256, cap-drop ALL and
no-new-privileges. HostConfig AND effective cgroup values are checked before any
heavy work. At least4GiB available RAM/8GiB free task and Docker storage are
required. Heavy commands are serial, bounded1200s (tests120s within180s external
bound), workflow45min. There is no sampling-based memory guarantee. Public task
working directories are writable by disposable container root so cap-drop ALL
needs no host sudo/chown; no private checkout/.git/credentials/host config mount.

Initial gofmt mismatch exports exact formatted sources and stops before any
compilation; it is not a build attempt or behavioral RED. Dependencies/test
compilation are acquired with network; actual focused service tests run in a
separate **network=none** container. Synthetic root custody fixtures install only
inside that disposable root. Official Node lives at `/usr/local/bin/node`; a
container-only symlink provides the production adapter's fixed `/usr/bin/node`.
Only `^TestSyncthingPolicy` and `^TestSyncthingLegacy` in service and the latter
in route/v1 run, no broad upstream network/Docker tests. Tests
exercise actual public refused methods and real Node transport, private injected
parser/destination ordering, fake ordinary Docker-writer success/failure,
strict transport/caps/cancellation/expiry and real synthetic helper custody.
The four legacy HTTP handlers are exercised through actual shared handler
implementations with httptest Recorder, no listener. Explicit private fake Docker
writers/scheduling/events and terminal continuation establish denial ordering and
resolved-ID targeting, not a real interactive WebSocket session. Synthetic success
is not a deployed mutation.

Full root manager build uses `go build -mod=readonly -p=1 -trimpath
-buildvcs=false`. ELF AArch64, SHA256/bytes, gzip and `go version -m` are recorded
without executing the binary. Artifacts retain original logs, source/generated
hashes, resource/cleanup receipts and exact modified sources; no module cache or
toolchain/private configuration is uploaded. Fresh pinned extraction/application
must reproduce every changed file and unchanged module. No bitwise reproducible
binary claim is made. Source changes require affected exact-head review/build;
no blind retries, at most two full build attempts for a concrete changed cause.

## Explicit remaining gates

Registered legacy v1 PUT `/:id` UpdateSetting, DELETE `/:id` UninstallApp,
PUT `/archive/:id` ArchiveContainer and GET `/:id/terminal` DockerTerminal
now use `CheckLegacyContainerMutation` before writes, async scheduling, HTTP101
or exec. Inspection uses request cancellation and a finite3s context. CURRENT
comes from actual Docker inspection, never a request selector; admitted effects
target its stable64-hex ID. Update checks CURRENT before binding, then the
effective candidate inheriting compose labels and replacing container/legacy name.
All available container/project/service/legacy-name/working-dir/config-file
markers are retained through multiple complete four-field policy identities.
Malformed/ambiguous projections and inspect/helper failures receive fixed403.
Ordinary well-formed no-compose legacy containers and prefix siblings remain
admitted; malformed legacy display names outside the policy's strict name grammar
fail closed. This does not change read/list/SetStatus or enable commented-out
InstallApp/ChangAppState routes. No total-manager/private-storage guarantee is made.
The separately registered v2 PATCH `/container/{id}` (`recreateContainerByID`)
still reaches `RecreateContainerByID` -> `Docker().RecreateContainer` without
these admissions, before asynchronous200/pull/clone/remove. It remains an explicit
**LIVE-readiness Blocking** trigger outside this four-legacy-handler scope.
Samba rollout, aliases/mounts/custody, ordinary-project impact, root-RC coverage and exact
rollback remain separate owner decisions. Do not install/execute either manager,
write live policy/config/DB/declarations, reload/restart services or mutate the
NAS from these scripts. PGDATA provisioning, database startup and public
deployment remain **HELD**. `primary_outcome_complete=false` and
`privacy_ready_for_pgdata=false`. Same-card independent technical review and
owner acceptance/integration are still required; specialists do not merge or
finalize this outcome.
