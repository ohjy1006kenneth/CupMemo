# Dormant private Compose preparation (Refs #32)

Primary `hq/t_7077042b`, original coder run3040. This is an **offline configuration
candidate, not deployment**. Accepted image preparation remains PR82, integrated
commit `9b000bac4c908bd86cd152968613dd294fa75204`, technical3210 / owner3233,
postmerge CI38988329447. No image, application, schema, development Compose or
startup guard change is included here. Issue32 remains open.

## What this candidate defines

`infrastructure/docker/production.compose.yml` has exactly three services:

- `cupmemo-web`: existing nonroot Node image, internal3101, frontend network only.
- `cupmemo-api`: existing nonroot Node image, internal4101, frontend and backend.
- `cupmemo-postgres`: explicitly selected official PG17 image, backend only.

Both networks are internal and project-scoped, not external/shared. No published
ports, host networking, Docker socket, cloudflared, ingress, host autostart or
startup migrations exist. The compiled web rewrite remains
`http://cupmemo-api:4101`; web browser requests remain same-origin. This dormant
stack deliberately provides no user-accessible entry point.

All services have `restart: 'no'`: this is **not restart protection delivered**.
Automatic Docker restarts could bypass the existing Issue11 host guard. A future
separately authorized Issue42/activation design must close startup/reboot/restart
bypasses before changing this policy. A successful config check or prior guard
receipt is never launch authority, a hot-unmount lock or a continuous supervisor.

Effective limits: web512MiB / API256MiB / PG512MiB; each CPU1, pids128. Each
`memswap_limit` equals `mem_limit`, requesting no swap allowance on supported
Linux Docker/cgroup configurations. Web/API budgets come only from accepted
negative/no-DB image smokes, **not positive application capacity acceptance**.
PG512MiB is a **PROVISIONAL ceiling**, not measured database capacity. Actual
engine enforcement and whole-Pi coexistence remain UNVERIFIED.

All capabilities are dropped; no-new-privileges is set. Web/API retain `user:
node`, read-only roots, and only a private64MiB `/tmp` tmpfs with
`noexec,nosuid,nodev,mode=1777`. It is scratch space, not persistence. No writable
Next cache or host bind is added. Compatibility with real authenticated traffic,
image processing and future cache behavior remains UNVERIFIED. PostgreSQL has a
writable root for its existing entrypoint/runtime needs; only its explicit bind
persists database data. All services use json-file rotation,10MiB x3 per service;
this does not prove secret-safe application logs or total Docker disk capacity.

Health definitions use installed Node fetch for web `/sign-in` (exact200) and
API `/ready` (DB-backed, unlike `/health` liveness), with3s request deadlines.
PG uses local TCP `pg_isready` with its declared user/database; this reports server
availability, not password validation, migration status, schema or app/auth health.
Checks have10s interval,5s timeout,6 retries and30s start period. API waits for PG
healthy; web waits for API healthy. These are **unexecuted health definitions**,
not evidence that any service starts. Dependency order does not monitor/restart
dependents when a database later fails.

## Explicit external inputs (no defaults)

Use a private operator-maintained interpolation env file outside the repository;
do not create or commit production values in this pass. Required inputs:

| Variable                 | Required operator selection                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `CUPMEMO_WEB_IMAGE`      | Accepted immutable local image ID or verified immutable registry digest |
| `CUPMEMO_API_IMAGE`      | Accepted immutable local image ID or verified immutable registry digest |
| `CUPMEMO_POSTGRES_IMAGE` | Official PG17 immutable ARM64 image matching the contract below         |
| `CUPMEMO_API_ENV_FILE`   | Absolute private external runtime env-file path                         |
| `POSTGRES_PASSWORD_FILE` | Absolute private external password-file path, never its value           |
| `POSTGRES_DATA_DIR`      | Absolute normalized pre-existing verified HDD-only bind source          |
| `POSTGRES_DATA_UID`      | Explicit positive numeric POSIX owner UID, never assumed999/root        |
| `POSTGRES_DB`            | Explicit nonsecret production database name, not a dev/test target      |
| `POSTGRES_USER`          | Explicit nonsecret database role                                        |

Images have `platform: linux/arm64` and `pull_policy: never`: there is no build,
implicit pull or mutable default. Local `sha256:<64 hex>` IDs identify actual
local image bytes, **not published registry manifests**. Accepted CI images were
built on disposable hosted ARM64 runners; their IDs alone do not make images
available on this Pi. Reconcile exact accepted image receipts and local availability
before activation. For a registry reference use `repository@sha256:<64 hex>`
with trusted read-only manifest metadata proving ARM64; no registry publication,
image pull or transfer is authorized here. No PostgreSQL digest is invented or
claimed accepted. This draft intentionally requires an operator-selected image.

The PG17 image must honor `POSTGRES_PASSWORD_FILE`, `POSTGRES_DB`, `POSTGRES_USER`,
`PGDATA`, arbitrary verified numeric UID operation and the installed `pg_isready`.
Its data mount contract must be `/var/lib/postgresql/data` (not the PG18 layout).
`PGDATA=/var/lib/postgresql/data/pgdata` is a fixed safe child inside that bind;
it is not a host fallback. No named/anonymous persistent volume is configured.
Before activation, inspect the chosen image's volume declarations to exclude
unexpected anonymous persistence. The long bind has `create_host_path: false`;
Compose rendering does not stat/provision it. No mkdir/chown/chmod/init/mount is
performed by this pass. In particular do not create the path merely to pass a
check. The existing Issue11 guard must freshly validate device/UUID/ext4,
ancestry, exact positive UID and0700/0750 data permissions. A path string, numeric
placeholder or successful config render is not HDD/owner validation.

The API external `env_file` is required and uses Compose `format: raw` to avoid
accidentally interpolating `$` in credentials. Use a current Docker Compose plugin
supporting raw env files (2.30+), long bind options and JSON config. Supply
`CUPMEMO_DATABASE_URL_PRODUCTION`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` there;
no app `_FILE` adapter is invented. The database URL must address the private
`cupmemo-postgres:5432` service, with the same independently verified database,
role and external password. Preserve existing strong auth-secret and production
origin validation. No legacy `DATABASE_URL`, development/test URLs or unrelated
variables belong in that file. Compose does not validate its application contents;
missing/invalid values must still fail closed in the existing API startup.
Explicit YAML environment pins production mode/internal host and port even if the
external file conflicts. Web receives only nonsecret internal routing settings.

The PG password is a Compose file-secret at `/run/secrets/postgres_password`, not
an environment value. Standalone Compose file-secrets are file mounts, **not an
encrypted secret store**; source file permissions must allow only the intended
operator/container UID and prevent other local access. Do not assume Compose
uid/gid/mode remapping for file-backed secrets. Verify chosen PG numeric UID,
image initialization behavior, runtime socket access, secret readability and
HDD ownership together before activation; this pass supplies no UID provisioning.

Interpolation only refuses missing/empty settings. It cannot enforce immutable
image selection, positive UID syntax, absolute HDD paths or safe secret contents.
Those remain mandatory reviewed operator/guard gates, not properties proven by
Compose's schema. Never render a real API env-file into retained JSON/logs:
`config --format json` expands its contents and would expose credentials.

## Non-launching verification

Run the focused test from the repository root:

```sh
corepack pnpm exec vitest run tests/production-compose.test.mjs --maxWorkers=1 --no-file-parallelism
corepack pnpm exec prettier --ignore-path /dev/null --check infrastructure/docker/production.compose.yml tests/production-compose.test.mjs docs/PRIVATE_COMPOSE.md
corepack pnpm exec eslint tests/production-compose.test.mjs
```

The test uses actual installed `docker compose config --format json` and
`--quiet`, without contacting a daemon (`DOCKER_HOST` is an absent Unix socket).
It creates only disposable SSD files with NONSECRET placeholders and syntactically
immutable **fictional image identities**, never real credentials or PGDATA.
It explicitly passes an empty `--env-file`, isolates inherited variables and
places a hostile `.env` in the disposable cwd to prove no implicit fallback.
It checks the effective model, every required omission and empty value, absent
external API file refusal, non-creation of data paths, resource/security/network
controls, health ordering and byte-identical development configuration. It does
not pull images or inspect real HDD/device/permission state. The rendered dummy
model stays in memory; only assertion summaries are retained. Tests fail rather
than skip if the Compose CLI is absent/incompatible.

After separate authorization to inspect real external config, a trusted operator
can perform quiet schema validation without retaining expanded secret output:

```sh
docker compose --env-file /private/operator/interpolation.env -p cupmemo-private -f infrastructure/docker/production.compose.yml config --quiet
```

This example path is not provisioned or approved. Do not replace quiet mode with
JSON output for real configuration. Config validation does not access the data
path or establish image presence, health, storage safety or readiness to launch.
There is intentionally no production launch recipe in this document.

## Still held / UNVERIFIED before any activation

Passing tests authorize no services, PGDATA provisioning, database startup,
migrations, NAS changes or public exposure. In particular, resolve together:

1. Exact accepted app and trusted PG17 ARM64 identities/availability, all private
   secret locations/ownership/readability and valid production app configuration.
2. Fresh HDD-only device/UUID/ancestry/UID/permission evidence and Issue11 guard
   integration. Missing-HDD refusal must prevent SSD fallback and bind creation.
   Check daemon restart, reboot and operator bypasses under separately reviewed
   Issue42 wiring; `restart: 'no'` alone does not prevent a manual start.
3. Remaining backup/rclone exclusions and CasaOS regeneration durability/privacy
   evidence. Previously accepted SMB client evidence is not repeated here.
4. Explicit owner/user authority for exact HDD provisioning and private activation,
   including separately authorized migrations and a reversible resource window.
5. Real DB-backed API readiness/auth/sessions/schema behavior, durable brew
   save/read/restart verification, memory/swap/OOM/CPU/log measurements and Pi
   coexistence alongside Hermes and unrelated services. Health config is not any
   of this runtime acceptance.
6. Separately authorized HTTPS/tunnel/PWA and real physical-phone acceptance;
   none is supplied or inferred by this private offline candidate.

Owner consolidates the remaining evidence into one bounded activation decision,
not repeated setup questions. Technical review of this exact config-only delta
precedes owner integration; no UI behavior changed, so no new rendered visual
review is claimed. Keep Issue32 open after partial integration.

Rollback of this preparation is a reviewed source revert of only this Compose,
its focused test and this document. It has no live resources to stop or data to
remove. A future authorized runtime plan needs its own exact-resource rollback,
private data preservation and no shared Docker prune/unrelated service changes.
