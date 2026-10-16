# Application image preparation (Refs #32)

This is application-only preparation, **not deployment** and not completion of
Issue32 (primary `hq/t_7077042b`, original implementer run3040; CI revision parent
run3048). No Compose, database, migration runner, storage provisioning, service
restart, registry publication, tunnel or public HTTPS is delivered. Existing
Issue11 HDD/PGDATA and startup/reboot/restart gates remain unchanged.

## Identity and inputs

Build from the repository root on native Linux ARM64. Both stages of both images
pin the same public `node:24-bookworm-slim` ARM64/v8 manifest:

```text
sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5
```

Registry inspection resolved this manifest from multi-platform index
`sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`.
It is Debian bookworm-slim, not Alpine or an emulated build. Resolve upgrades
explicitly and review both Dockerfiles together; tags alone are not identities.
Corepack0.36.0 bootstraps pnpm10.34.6; installation uses the unchanged frozen
lockfile. Dependency install concurrency is bounded. Build only one image at a
time after a fresh capacity check; stop rather than prune shared caches or
disrupt other services if capacity is inadequate.

The context denies everything by default, reopens named source/manifests/assets,
and excludes nested secrets, dependency directories, build residue and data.
Dockerfiles independently allowlist COPY inputs. Do not store private data under
source/asset names: ignore patterns cannot recognize arbitrary secret contents.
No secret ARG, `.env`, private npm configuration or enabled auth/DB example is
accepted. Public base/dependency registries must be reachable during builds;
smokes have no external networking.

Web uses Next's `output: 'standalone'` with an explicit repository-root tracing
boundary resolved from the ESM `apps/web/next.config.ts` URL, independent of cwd.
Only generated traced runtime files are copied from `.next/standalone`; no web
pnpm deployment/full dependency tree or untraced workspace sources are copied.
The monorepo layout is `/app/apps/web/server.js`, with public assets at
`/app/apps/web/public` and static chunks at `/app/apps/web/.next/static` (Next does
not copy these asset trees automatically). Docker fails if the generated server
or route-manifest layout changes; real pinned Next16.3.8 ARM64 CI must still prove
traced contracts/UI, compiled pages and all required assets resolve.

API uses pinned pnpm10.34.6's supported `deploy --legacy --prod --no-optional`.
This retains declared production dependencies and portable workspace links without
lockfile or injection-setting changes. Compiled contracts/database dist and
committed Drizzle resources are copied explicitly; no migrations execute. Known
first-party source/build-config payload is excluded. The subsequent owner decision
(issue comment6222233963; primary `hq/t_7077042b`, original3040/revision3195)
authorizes **only 40 exact version-bound test/fixture directory roots** from the
original API inventory, not general library pruning. The explicit list lives in
`api.Dockerfile`; runtime `/app` maps to disposable builder `/out`. Nothing is
removed from web, the base image/global npm, whole packages or the host. There is
no new dependency, lockfile change, package metadata rewrite or audit exception.
Missing targets, manifest name/version drift, path escape, symlink ancestors and
runtime entry/export targets inside a deletion fail before any deletion. The
builder verifies retained regular-file SHA-256, modes, ownership, sizes, timestamps,
inodes/link counts and symlink targets before/after, including adjacent worker,
driver, resource, license/notice and package metadata files. Directory modes and
ownership are compared; directory timestamps/link counts necessarily change when
children are removed, and access times are not invariants of reading files.
Runtime main/exports (including wildcard targets, excluding type-only conditions)
and retained symlinks must resolve to existing retained targets within `/out`.

`assembly.json` records each removed relative root, file/link count and logical
regular-file bytes, checked runtime entries and full retained before/after maps.
It is stored outside `/out`. A separate **build-only scratch export stage** copies
only this metadata to CI via the BuildKit local exporter, without starting a
container, using a host mount or adding evidence to runtime. CI validates the
manifest and records its SHA-256 with the actual API image ID. Partial build logs
and any already-exported evidence remain uploaded on failure; a failed build may
have no exportable manifest and is never acceptance. The strict recursive runtime
audit still rejects any unexpected test/fixture payload: unapproved roots are
neither removed nor exempted.

CI records retained packages and unresolved optional peer/dependency declarations
(not a complete lockfile diff), requires API/workspace dependency imports including
`pg`, and rejects retained Next/React closure. Further drift or new forbidden
payload requires a new owner disposition, not expansion of the deletion list.

The upstream base retains Node/npm utilities. CI inventories retained packages,
flags compiler/test tooling and forbidden files, and measures actual sizes before
any efficiency acceptance. Monorepo `apps`/`packages` directories are no longer
blanket-forbidden: their first-party source/config/cache payload remains audited,
alongside unchanged recursive secret/context/test/tooling exclusions.

## Network and configuration boundary

- Web listens on `0.0.0.0:3101` **inside its container only**. API listens on
  `0.0.0.0:4101` through existing `CUPMEMO_API_HOST`/`CUPMEMO_API_PORT` controls.
  EXPOSE publishes no host port; these images change no loopback development
  commands/defaults.
- Web builds with server-only `CUPMEMO_API_ORIGIN=http://cupmemo-api:4101`.
  Next embeds the `/api/v1/:path*` rewrite in
  `apps/web/.next/routes-manifest.json` under the runtime root. The generated
  standalone `server.js` embeds the serialized Next config; no source TypeScript
  Next config or runtime compiler is required. Runtime `HOSTNAME=0.0.0.0` and
  `PORT=3101` configure that direct Node server. Runtime `CUPMEMO_API_ORIGIN`
  defaults to the same internal API origin for server-side session fetches; it
  is not a secret and does not retarget the compiled rewrite.
  Changing an environment variable after build does **not** retarget this rewrite.
  A different private API service name requires a reviewed rebuild. The browser
  still calls same-origin `/api/v1`; no internal target is a NEXT_PUBLIC variable.
- Future authorized orchestration must supply `BETTER_AUTH_URL`,
  `BETTER_AUTH_SECRET`, `CUPMEMO_DB_ENV=production` and the dedicated
  `CUPMEMO_DATABASE_URL_PRODUCTION` **only at runtime** using private secret
  handling. Never use build arguments, image layers or committed env files.
  No values are supplied here. Auth/session continuity and positive API readiness
  cannot be accepted without a separately authorized isolated DB test.
- API default CMD starts compiled `dist/server.js`. Missing configuration exits1
  with exactly `API startup failed. Check non-secret configuration and port availability.`
  before listening or connecting. There is no fallback database, startup migration
  or artificial healthy mode.
- Runtime is unprivileged `node`; exec-form Node commands receive termination
  signals, with the existing API graceful pool shutdown unchanged. The web smoke
  exercises the actual image default CMD, not a substitute server command.

## Native CI execution (correction results pending)

Historical candidate `a6896684fbea4e2c7b71f12d8790c93279cf402d`, CI run
`38845509487`, produced web711888204 and API708884389 uncompressed bytes:
both failed the unchanged500/300MiB targets and retained unwanted closure.
Those original results remain failures, not acceptance of this correction.
Subsequent candidate `68fb6593f097af03f35487b55053c0c8de5a0fd2`, native CI
`38947906803`, met both size caps and passed bounded smokes/imports, but its API
inventory rejected48 test/fixture paths under the40 approved nonnested roots.
Its quality PASS does not convert the container-images FAIL into acceptance.
The exact assembly revision requires new final-head API evidence and both required
CI jobs; valid unchanged web/app/context evidence is not an excuse to bypass CI.
The owner correction explicitly authorizes a seventh file,
`apps/web/next.config.ts`, alongside the existing image/context/test/doc/workflow
scope. No dependency, lockfile, package metadata or quality-job change is authorized.
New exact-candidate native ARM64 image and quality jobs plus independent affected
review are required; no local heavy build or new image result is claimed here.

The additional `container-images` job in `.github/workflows/ci.yml` runs on the
standard GitHub-hosted `ubuntu-24.04-arm` runner, on the existing pull-request and
main push triggers. It uses `contents: read`, no repository secrets, and checkout
without persisted credentials. The existing independent `quality` job is
unchanged. Job timeout is45minutes; execution step is40minutes, leaving time for
failure evidence upload. Each build is individually bounded to15minutes.
No larger/paid/self-hosted runner, QEMU, registry publication or repository setting
change is part of this pass. Actual scheduling/capacity remains unverified until
GitHub executes this candidate.

Action revisions were resolved from the official `actions/checkout` and
`actions/upload-artifact` GitHub API tag refs and their actual action manifests:

- Checkout v6: `d23441a48e516b6c34aea4fa41551a30e30af803`.
- Upload-artifact v7: `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (Node24 action).

The inline workflow is the executable acceptance procedure. It:

1. Records checked-out SHA/tree, workflow SHA, run/attempt and source hashes;
   requires a clean candidate and native ARM64 host/daemon/base/image identities.
   Pull-request runs normally check the GitHub test merge commit; the recorded
   source identity must be matched to that run, not mislabeled as the PR branch SHA.
2. Pulls only the pinned public Node base; records base/image inspections and
   full layer history. Before **each** serial web then API build, records actual
   memory/disk/load and refuses below4GiB available RAM or5GiB free disk on either
   the workspace or Docker filesystem. There is no shared-cache prune, toolchain
   deletion, parallel matrix or automatic capacity retry.
3. Builds exact Dockerfiles with repository-root context and unique task tags
   `cupmemo-issue32-<run_id>-<attempt>-web/api`; all subsequent runs use immutable
   image IDs. No image transfer to the Pi or push occurs.
4. Inventories runtime package names/versions, logical directory sizes, forbidden
   context/build/source/test inputs and retained compiler/test tooling. Symlinks
   are not followed for logical byte totals; actual image-layer measurements are
   separate. Exclusions or required runtime imports that fail keep CI nonzero.
5. Runs each task-owned smoke with network none, no host ports/binds/volumes,
   read-only root, private64MiB `/tmp` tmpfs, all capabilities dropped,
   no-new-privileges and nonroot image user. Inspects effective container controls.
   Web uses memory512MiB, memory-swap512MiB (**no swap allowance**), CPU1 and
   pids128. Internal clients assert the real `/sign-in` HTML form and every
   referenced static asset return200, validate `/manifest.webmanifest` and all
   declared icons plus touch/SVG assets, and check the exact compiled private
   rewrite. A real anonymous `/app` redirect loads compiled layout/session/origin
   modules without Cookie, fake session or DB. This is module-loading/anonymous
   behavior only, not authenticated session acceptance.
   Finite readiness and per-request deadlines prevent unbounded waits.
6. Records web startup-to-ready, idle and short repeated-request Docker memory/CPU
   stats, request outcomes, actual SIGTERM completion, exit/error/OOM state. The
   load client is bounded and checked for failure. These are **short no-DB smoke
   samples**, not a sustained production benchmark or whole-Pi capacity result.
7. Runs the API actual default CMD with no supplied configuration under256MiB
   memory/no-swap, CPU1 and pids128; requires exit1 and the exact sanitized refusal.
   A separate container under the same limits imports actual compiled app/auth
   modules and contracts/database/Fastify/Better Auth/adapter/Drizzle/Zod without
   starting a database. It also runs real Fastify `inject` (no listen/socket), JSON
   schema validation/serialization, Zod success/refusal and Pino structured request
   logging against the retained packages. Valid/schema-invalid/Zod-invalid controls
   must return200/400/422. It verifies retained Pino and thread-stream worker files,
   sonic-boom and the workspace-resolved pg driver; the assembly hash comparison
   protects all their adjacent files too. These packaging-only routes exist solely
   in the CI in-process probe, never in product code. Fast refusal may end before
   useful memory samples exist; neither probe is positive API/database load acceptance.
8. Reconciles logs and state before removing **only exact task-owned containers**,
   including on assertion failure. Never prunes or deletes other images, caches,
   volumes, services or data. A step/job hard timeout or runner loss may interrupt
   cleanup; the disposable hosted runner is the remaining isolation boundary.

Local lightweight/context checks remain available, without a local image build:

```sh
corepack pnpm exec vitest run tests/container-images.test.mjs --maxWorkers=1 --no-file-parallelism
# Explicit opt-in: scratch-only context exports; no application image build/run.
CUPMEMO_CONTEXT_PROBE=1 corepack pnpm exec vitest run tests/container-images.test.mjs --maxWorkers=1 --no-file-parallelism
```

The opt-in test checks actual COPY input survival and sensitive/residue exclusion
using non-secret sentinels, including directory and worktree-file `.git` forms.
A skipped probe is not context acceptance. Previously retained unchanged3/3 real
context results can be reused only while the exact inputs remain unchanged.
No new local heavy builds are authorized for this CI execution amendment.

## Efficiency targets and failure disposition

Final **uncompressed** image targets are web≤500MiB and API≤300MiB (MiB =1024²
bytes). CI records actual Docker image `Size`, target bytes and target comparison.
It also streams `docker image save` through an in-memory tar reader to measure
uncompressed layer tar lengths, records each content-addressed diffID/size, and
computes shared layers and the combined union **without double-counting** common
layers. The streamed archive is not retained or uploaded; no second on-disk image
copy is created. Layer archive totals exclude image metadata and tar padding
outside the individual layers; they are not a claim of exact storage-driver disk
allocation. Compressed registry/transfer size is explicitly unknown, not guessed.
Image size, logical directory bytes, layer bytes and runtime RAM are distinct.

A size-target or runtime-exclusion miss is recorded and fails the job after
collecting both images' evidence when builds/smokes permit. A build or smoke
failure stops execution immediately and preserves partial results. Missing
measurements are not PASS. Inspect actual largest layers/directories/dependencies
before proposing the smallest scoped packaging correction. An exception requires
an evidence-backed owner disposition before acceptance; the workflow does not
waive targets. This owner-authorized correction uses standalone/tracing and
supported API optional-dependency selection in response to the historical misses;
its actual image measurements remain pending native CI.

**UNVERIFIED until actual execution and review:** both native builds, runtime
exclusions, image targets, shared/unique bytes, imports, bounded web page/static
smoke, startup/stats/termination. **Still unverified even if these pass:** positive
API/database readiness/auth/session continuity and256MiB sustained API behavior;
PostgreSQL/tunnel resources; full-stack coexistence on the actual8GB Pi alongside
existing services. Future same-card Compose must encode evidence-backed limits
and validate actual Pi coexistence before launch. No image/efficiency PASS is
claimed by this document or static checks.

## Evidence, acceptance and rollback

The workflow always attempts upload of original sanitized evidence as
`issue32-arm64-<run_id>-<attempt>` with14-day retention. Upload failure or missing
files fails; there is no `continue-on-error`. The artifact includes numbered
original command/output logs with argv/exit/timing, orchestrator output, source
and base/image identities, effective container inspections, inventories, image
and layer measurements, readiness/load/termination records and dispositions when
reached. It uploads only its task evidence directory outside the checkout: no
raw filesystem/image archives, environment dumps, credentials or private configs.
No auth/DB values are passed to the builds or smokes. Partial artifacts on failure
are expected and must not be described as complete acceptance.

Before handoff, download the original artifact through the GitHub API and verify
run/workflow identity, exact checked-out SHA/tree, artifact identity/digest and
contents against the final candidate. Retain original failed and successful logs
separately. Existing local evidence belongs outside source under
`/home/juyoungoh/.hermes/profiles/code-monkey-cupmemo/workspace/evidence/t_7077042b`.
No successful new CI execution or artifact readback is claimed here. Final-head
quality CI plus actual ARM64 results and same-card independent LIGHT technical
review are required before owner acceptance. A PR must use `Refs #32`, not close
Issue32. No application/UI behavior was intentionally changed.

Rollback preparation by reverting only the seven authorized source files through
normal review (the five image/context/test/doc files plus CI and Next config),
preserving the existing quality job. Optionally remove only exact
identified task-owned image IDs after checking no task container still uses them.
Never prune shared caches, remove other images/volumes, touch database data or
change live services. Production Compose/HDD restart protection, private
networking/health policies, secret supply, tunnel/HTTPS, backups/restore,
production auth and deployment approval remain gated on the same Issue32.
