# Dormant private Compose preparation (Refs #32)

Primary `hq/t_7077042b`, original coder run3040. This is an **offline configuration
candidate, not deployment**. Accepted image preparation remains PR82, integrated
commit `9b000bac4c908bd86cd152968613dd294fa75204`, technical3210 / owner3233,
postmerge CI38988329447. Offline Compose preparation was accepted in PR83,
integrated commit `e7c6d04b3adba00bc0e1e15deb3d8bd195db4441`, technical3271 /
owner3272. This continuation adds source-only guarded startup wiring and a dormant
service template; the existing HDD guard, Compose model, images, application,
schema and development configuration remain unchanged. Issues32/42 remain open.

## What this candidate defines

`infrastructure/docker/production.compose.yml` has exactly three services:

- `cupmemo-web`: existing nonroot Node image, internal3101, frontend network only.
- `cupmemo-api`: existing nonroot Node image, internal4101, frontend and backend.
- `cupmemo-postgres`: explicitly selected official PG17 image, backend only.

Both networks are internal and project-scoped, not external/shared. No published
ports, host networking, container Docker socket, cloudflared, ingress, installed
host autostart or startup migrations exist. The compiled web rewrite remains
`http://cupmemo-api:4101`; web browser requests remain same-origin. This dormant
stack deliberately provides no user-accessible entry point.

All services have `restart: 'no'`: this is **not restart protection delivered**.
Automatic Docker restarts could bypass the existing Issue11 host guard. The
prepared wrapper below runs a fresh guard on each service start, but does not
close manual Docker/root bypasses. A separately authorized Issue42/activation
design must address runtime/reboot/restart safety before changing this policy.
A successful config check or prior guard
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

Use explicitly supplied environment settings, maintained privately outside the
repository; do not create or commit production values in this pass. The startup
wrapper does not read/source an interpolation file or load `.env`. Its future
service may receive settings from a required trusted systemd EnvironmentFile.
Required Compose interpolation inputs:

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

## Source-only guarded startup (not installed or authorized to launch)

`infrastructure/scripts/private-stack-start.mjs` exports `runPrivateStack` and
`main`; importing it is silent and does not probe or spawn. Its production CLI
accepts exactly `--start`, not arbitrary commands or alternate services/actions.
This describes a held interface, not a production activation recipe.

In addition to the nine settings above it requires:

| Variable                    | Explicit operator selection                                 |
| --------------------------- | ----------------------------------------------------------- |
| `POSTGRES_HDD_MOUNT`        | Absolute normalized expected mount root, per existing guard |
| `POSTGRES_HDD_UUID`         | Canonical lowercase ext4 UUID, per existing guard           |
| `CUPMEMO_DOCKER_CONFIG_DIR` | Trusted external Docker client configuration directory      |

All inputs must be nonempty strings without control characters. Image inputs
must be local `sha256:<64 lowercase hex>` or `repository@sha256:<64 lowercase
hex>` shapes, never mutable tags alone or options. Shape is not trusted image
provenance, ARM64 compatibility, PG17 compatibility or local availability.
API/password/Docker-config paths must be absolute, normalized, nonroot, without
trailing slash and outside this checkout. This does not inspect external file
contents, permissions, symlinks or Docker plugins/configuration: trusted release
and external configuration ownership remain mandatory operator gates. Docker
configuration can select CLI plugins/credential helpers; it is executable trust,
not a sandbox. No credential values are placed in wrapper argv/environment.

After configuration validation, the wrapper directly calls the unchanged
`verifyPostgresHdd` with the same snapshotted data path and UID used for Compose.
Any refusal suppresses **all** Compose actions without creating/changing paths.
Each call checks afresh; no successful receipt is cached. The guard's
device/UUID/ext4/ancestry/UID/mode checks still own the HDD semantics.

Only then can it spawn `/usr/bin/docker`, with `shell:false`, `detached:false`,
fixed local endpoint `--host unix:///var/run/docker.sock`, explicit `--config`
directory, `compose --env-file /dev/null --project-name cupmemo-private --file`
the absolute repository-relative `production.compose.yml`, followed by exactly
`up --no-build --pull never --abort-on-container-failure`. The Compose file is
resolved from the module location, not cwd or caller input. No overlays, profiles,
detached start, arbitrary command, migration or broad cleanup route is offered.
The host paths `/usr/bin/node`, `/usr/bin/docker`, `/usr/bin/findmnt`, Unix socket
and `/dev/null` are Linux deployment assumptions, not portable discovery.

The child receives only the nine interpolation inputs and deterministic
`PATH=/usr/bin:/bin`, `LC_ALL=C`, `COMPOSE_DISABLE_ENV_FILE=1`. Inherited HOME,
DOCKER_HOST/CONTEXT/TLS settings, COMPOSE_FILE/PROFILES/ENV_FILES, NODE_OPTIONS and
unrelated credentials are not forwarded. `--env-file /dev/null` disables implicit
dotenv interpolation; the external API raw env-file and password file remain
Compose-managed inputs. Starting Node itself still requires a trusted caller
environment; child filtering cannot undo a hostile host `NODE_OPTIONS` preload.

Child stdout/stderr are discarded at spawn, never buffered/redacted. Diagnostics
are fixed phases: invalid CLI/configuration, HDD verification refused, launching,
child launch failed, child exit (numeric status), child signal (OS whitelist).
No raw exceptions, expanded configuration, paths or child output are printed.
This intentionally sacrifices Compose detail: a future approved operator diagnosis
must protect secrets separately. The wrapper preserves child exit/signal results,
forwards SIGINT/SIGTERM/SIGHUP and escalates an ignoring child to SIGKILL after
2000ms, removing its signal handlers/timer on settlement.

`infrastructure/systemd/cupmemo-private.service.in` is **uninstalled, disabled
source**, with no `[Install]` wiring. It requires trusted substitutions for
`@CUPMEMO_RELEASE_DIR@`, `@CUPMEMO_STARTUP_ENV_FILE@` and
`@CUPMEMO_OPERATOR_USER@`; there is no default user, inferred UID or optional env
file. Substitution must use directive-appropriate systemd quoting/escaping
(including whitespace, `%` specifiers and `$` ExecStart expansion), and a real
nonroot operator with separately reviewed Docker-socket access. Do not perform
naive textual substitution of arbitrary untrusted strings. Release ownership,
external environment, executable trust and exact rendered unit need independent
operator review before installation; no renderer/install script is supplied.

The template uses `Type=simple`, `Restart=no`, `KillMode=control-group`,
`TimeoutStopSec=15s`. Its sole ExecStart runs the wrapper, not an ExecStartPre-only
check, so each future explicit service start/restart would perform fresh checking.
`After=docker.service` only orders; there is no Requires/Wants to independently
activate or restart shared Docker. No ExecStop down/prune or auto-migrations exist.
There is no service enablement, daemon reload, service operation or deployed reboot
test in this preparation.

This remains **guard-before-launch**, not continuous mount locking: TOCTOU,
hot-unmount/replacement after verification, arbitrary root/manual `docker start`
or `docker restart` bypasses remain. `restart: 'no'` prevents automatic engine
restarts, not manual bypass. Docker workloads are daemon-side and may survive a
wrapper/Compose crash or SIGKILL, even with control-group killing; killing the CLI
is not proof containers stopped. No broad rollback is attempted. A future
exact-resource runtime plan must validate stopping only owned resources, preserve
private HDD data and protect unrelated services. Fixture success is not real
HDD/DB/stack/reboot acceptance or permission to activate.

## Non-launching verification

Run the focused test from the repository root:

```sh
corepack pnpm exec vitest run tests/private-stack-start.test.mjs tests/production-compose.test.mjs --maxWorkers=1 --no-file-parallelism
corepack pnpm exec prettier --ignore-path /dev/null --check infrastructure/scripts/private-stack-start.mjs tests/private-stack-start.test.mjs docs/PRIVATE_COMPOSE.md
corepack pnpm exec eslint infrastructure/scripts/private-stack-start.mjs tests/private-stack-start.test.mjs
```

The unchanged Compose test uses actual installed `docker compose config --format json` and
`--quiet`, without contacting a daemon (`DOCKER_HOST` is an absent Unix socket).
It creates only disposable SSD files with NONSECRET placeholders and syntactically
immutable **fictional image identities**, never real credentials or PGDATA.
It explicitly passes an empty `--env-file`, isolates inherited variables and
places a hostile `.env` in the disposable cwd to prove no implicit fallback.
It checks the effective model, every required omission and empty value, absent
external API file refusal, non-creation of data paths, resource/security/network
controls, health ordering and byte-identical development configuration. An unsafe
dummy variant proves `create_host_path: true` is distinguishable in the effective
model; Compose versions differ in which flag value JSON omits, so the test also checks
the candidate's explicit false source setting. Neither variant creates the path.
It does not pull images or inspect real HDD/device/permission state. The rendered dummy
model stays in memory; only assertion summaries are retained. Tests fail rather
than skip if the Compose CLI is absent/incompatible.

The startup tests use disposable task-owned SSD directories, parameter-injected
mount evidence and fake child transport, never a live Docker daemon/image or DB.
They assert literal fixed argv/minimal environment, configuration-before-guard-
before-child ordering, repeated-start refusal, no mutation, sanitized diagnostics,
real CLI absent/SSD refusals and actual Node fake-child status/signal/output-drain
behavior. The service source is checked without installation. Offline
`systemd-analyze verify` of a dummy rendered SSD unit is only static verification;
tooling limitations must be reported, never replaced with deployed-service claims.
Existing accepted guard/image evidence is reused while those sources stay unchanged.

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
   runtime integration. Missing-HDD refusal must prevent SSD fallback and bind creation.
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
not repeated setup questions. Technical review of this exact source-only delta
precedes owner integration; no UI behavior changed, so no new rendered visual
review is claimed. Keep Issue32 open after partial integration.

Rollback of this continuation is a reviewed source revert of only its startup
wrapper, dormant service template, focused startup test and this document; accepted
Compose/image checkpoints remain unchanged. It has no live resources to stop or data to
remove. A future authorized runtime plan needs its own exact-resource rollback,
private data preservation and no shared Docker prune/unrelated service changes.
