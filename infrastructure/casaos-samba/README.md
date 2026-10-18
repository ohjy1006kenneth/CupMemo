# CasaOS Samba writer policy — source distribution only

Refs [Issue #11](https://github.com/ohjy1006kenneth/CupMemo/issues/11), primary
`hq/t_9cbb487a`. This bundle publishes an existing compiled/tested source
checkpoint, **not installed enforcement, an installer or activation permission**.
`source-lock.json` version1 records public inputs, output hashes, commands and
native provenance. Original implementer `code-monkey-cupmemo`, integer original
run2817; compiled revision3354 → independent3355 → owner3356; publication3357.
Only the owner integrates or authorizes a separately reviewed live rollout.

## Distribution and provenance

- `casaos-samba-policy.patch` is the byte-identical accepted cumulative patch,
  SHA256 `8b03799aea01572d552506cceae6ed34336f89f02f1a06f1737d5e9738aa4555`.
  It changes the actual HTTP route and share service, adds the Go policy helper
  and Go tests, and materializes the **real executable Node24 adapter** at
  `service/testdata/samba-policy.mjs`. There is no second active adapter copy here.
- `upstream/route/v1/samba.go` and `upstream/service/shares.go` are exact ORIGINAL
  inputs from IceWhaleTech/CasaOS revision
  `ba285cb8bddb85fbd93060b3a8b944f35dd7a7ad`, not modified outputs. This minimal
  offline patch-application fixture is not a second manager or runnable service.
- `upstream/LICENSE` is the exact Apache License 2.0 file in that pinned archive.
  No root NOTICE file was present. CupMemo modifications are the policy integration,
  guarded writer, tests and adapter in the patch; original attribution is retained.
  Full upstream source remains available through the pinned archive in the lock.
- No generated packages, binaries, toolchains, caches, host configuration, database
  data or private logs are vendored. The lock's existing compiled artifact is
  distinct from this publication commit; no bitwise-reproducible-build claim.

## Private boundary and trigger ordering

The adapter preserves one owner-managed `[nas]` even with zero CasaOS rows.
It preserves ordinary University/control sections byte-for-byte, including their
existing access settings; no global veto or root `smb.conf` override is added.
Canonical policy requires path `/DATA/nas` and `veto files = /cupmemo/`; fixtures
are synthetic, never the actual private stanza. The veto is Samba name-pattern
matching and can also deny `cupmemo` at other depths.

Protected nas-name mutations, reserved descendants and broad ancestors are refused.
Component siblings `/DATA/nas-other` and `/DATA/nas/cupmemo-other` remain ordinary.
Unsupported/ambiguous INI, duplicate sections/directives, conflicting canonical
settings and dynamic include/copy directives refuse rather than guess Samba
precedence. These are **lexical checks**, not live symlink/mount/alias protection.

Fixed future paths (UNINSTALLED):

- root-owned private0600 `/etc/cupmemo/nas-samba.json`, exact
  `{"version":1,"canonicalNas":"<privately approved stanza>"}`;
- root-owned safe `/usr/local/lib/cupmemo/samba-policy.mjs` and `/usr/bin/node`;
- atomic replacement of `/etc/samba/smb.casa.conf`, preserving root include wiring.

The only adapter CLI is `node samba-policy.mjs --transform`. Private stdin is
version1 `{canonicalNas,generated}` plus optional `mutations` (exact
`operation,name,path`; create/delete/delete-by-path). Success stdout is private
`{"version":1,"config":"..."}`, with empty stderr. Refusal has **empty stdout**
and one fixed sanitized stderr code; invalid CLI exits2, policy/protocol exits1.
Do not log successful configuration transport. Raw stdin/output is bounded to1MiB;
input deadline1500ms. The Go caller uses fixed argv/no shell, a3s context,
250ms WaitDelay, capped stdout, discarded stderr and a minimal environment excluding
`NODE_OPTIONS`. Unknown/duplicate/trailing envelope fields refuse.

Create validates the whole batch and prospective config before chmod/DB/write/reload;
service create rechecks under its mutex. ID delete resolves and validates the actual
row before deletion. Path delete selects actual component-contained rows, not prefix
LIKE matches. Direct generation also validates bounded rows and canonical input,
then invokes the real adapter, atomically writes, and runs bounded fixed
`/usr/bin/systemctl reload smbd`. Zero rows still regenerate canonical nas.
Policy/executable opens verify safe root-owned ancestry and no-follow/single-link
regular files. There is no shell restart or stock-writer fallback. Legacy root
initialization is not called by create and is not an installation repair mechanism.

This is **not a cross-resource transaction**. DB/chmod may succeed before later
write/reload failure. Rename may succeed before directory-fsync/reload failure.
The caller returns refusal rather than false success, but cannot claim no effect;
reconcile exact DB/include/service state before retry. The mutex covers one
service instance, not privileged external writers or future manager versions.

## Offline publication verification

From the CupMemo root with existing frozen workspace dependencies:

```sh
corepack pnpm exec vitest run tests/casaos-samba-source.test.mjs --maxWorkers=1 --no-file-parallelism
```

This actually applies the published patch with bounded shell-free Git argv to a
uniquely owned disposable fixture, checks all five output hashes before executing
the materialized Node adapter, and exercises private protocol and policy behavior.
Pi fixtures verify SSD UUID before creation and ignore inherited TMPDIR; hosted
runner temp is ephemeral storage, **not mounted-HDD or live privacy evidence**.
Only the owned fixture is removed. No Go/main execution, host writes, listeners
or production DB connections occur. Existing hosted quality/container CI checks
the CupMemo publication HEAD, not a rebuilt CasaOS manager.

## Existing compiled proof and future reproduction

Actual full patched ARM64 manager build2 exited0 with official task-local Go1.26.9;
independent affected Go tests passed10 top-level +52 subtests. Original go.mod/sum
are unchanged. Both real generated packages repeated byte-equal with pinned
`oapi-codegen@v1.12.4`; MessageBus schema is pinned to
`67bcaffb3678a0720f52b9fd702de67da47fad74`, not mutable main.
Native408 contains original source/check evidence; native409 retains the gzip.
The31674476-byte binary SHA256 is
`924c914aea70966a67e90afb7dca86e793edea86ed7e67ff7a92c802c1b60d56`.
It has **never been executed or installed**. Earlier32 Node/testparm controls and
unchanged client evidence are reused, not replayed by this packaging pass.

Historical build/test/generator sampling gaps134.948/194.851/166.554ms **FAILED**
the literal ≤100ms condition. CPU150%/pids128 was enforced; there was no hard
memory cgroup. Owner3356 accepts independently verified artifact validity only,
not retrospective resource compliance or reuse of deficient monitoring. No new
Go/Next/container build on the Pi is authorized here. A future heavy build needs
separately settled enforceable resource limits, preferably disposable hosted hard
limits, before any commands below are executed.

Future reproduction in that separately authorized environment:

1. Acquire the exact CasaOS and official Go archives and MessageBus schema URLs
   in `source-lock.json`; verify **bytes and SHA256 before extraction/use**.
   Extract regular source without following archive symlinks. Use a task-local
   toolchain/cache and unchanged original module files. This fixture lacks most
   source: the complete pinned archive, not `upstream/`, is required to build.
2. In the full disposable source, run `git apply --check <absolute-published-patch>`
   then `git apply <absolute-published-patch>`. Check all five locked output hashes
   and module hashes. Do not apply to the installed host manager.
3. With the verified toolchain's bin on PATH, private HOME/TMPDIR/GOCACHE/GOMODCACHE,
   Node24 `/usr/bin/node`, pinned module integrity verification and external hard
   resource enforcement, use the settled commands below. The schema placeholder
   is the local checksum-verified MessageBus file; artifact is an owned output
   directory. Never run upstream mutable `go generate`, `go get` or `go mod tidy`.

```sh
export CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOTOOLCHAIN=local
export GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS=-p=1
mkdir -p codegen/message_bus
go run -mod=readonly github.com/deepmap/oapi-codegen/cmd/oapi-codegen@v1.12.4 -generate types,server,spec -package codegen -o codegen/casaos_api.go api/casaos/openapi.yaml
go run -mod=readonly github.com/deepmap/oapi-codegen/cmd/oapi-codegen@v1.12.4 -generate types,client -package message_bus -o codegen/message_bus/api.go <verified-message-bus-schema.yaml>
go test -mod=readonly -p=1 -count=1 -timeout=120s ./service -run '^TestSambaPolicy' -v
go build -mod=readonly -p=1 -trimpath -buildvcs=false -o <artifact>/casaos-linux-arm64 .
```

Verify generated output hashes against the lock and repeat generation to separate
output files for byte equality. Preserve actual commands/results and new binary
identity; matching source does not promise an identical binary on another host.
Do not execute the manager to inspect its metadata. A non-ARM64 host needs a
separately selected native test environment; cross-compilation does not run tests.

## Still held before rollout

A new exact-candidate live impact/rollback review must verify current canonical
policy/root/include/manager baseline hashes, installed safe root-owned storage,
alias/realpath/mount identity and actual University disjointness, existing root
include wiring, all real create/delete/direct-generation triggers and reload.
Fixture strings, compilation and a closed GitHub Issue11 do not establish these.
Rollback must compare current state to the exact installed candidate and restore
only reviewed manager/policy/include bytes with an authorized minimal reload.
Returning to the stock generator restores a **known durability gap**, not privacy.

Syncthing per-app pre-update/image restriction and unrestricted root rclone RC
remain separate unfinished gates; this patch implements neither. No live manager,
policy/include, NAS permissions, DB rows, service regeneration/reload/restart or
image change is authorized here. PGDATA path/UID provisioning, database startup
and public deployment remain held. `primary_outcome_complete=false` and
`privacy_ready_for_pgdata=false`. See [deployment](../../docs/DEPLOYMENT.md) and
[NAS isolation](../../docs/NAS_ISOLATION.md) for the separate historical controls
and owner-only activation gates.
