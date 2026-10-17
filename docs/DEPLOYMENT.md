# CupMemo Deployment

## Initial production host

CupMemo initially runs on a Raspberry Pi 5 home server.

Existing environment:

- Raspberry Pi 5
- SSD
- external HDD
- Hermes already running on the Pi
- developer PC connects via Tailscale + SSH

Do not disrupt Hermes or unrelated services.

## Storage

### SSD

Use the SSD for:

- GitHub repository checkout
- source code
- node_modules/build context
- application build output
- normal development/application files
- optionally a backup copy of DB dumps when appropriate

### External HDD

Use the external HDD for:

- production PostgreSQL data

Do not place PostgreSQL's live data directory inside the Git repository.

Do not assume the HDD mount path. Discover it on the actual Pi.

## Production services

Target Docker Compose services:

```text
cupmemo-web
cupmemo-api
cupmemo-postgres
cloudflared
```

Use:

- private Docker networking
- health checks
- sensible restart policies
- externalized environment configuration
- persistent database storage
- structured logs

Do not expose unnecessary ports.

## Intended network path

```text
Internet
   |
HTTPS
   v
Cloudflare
   |
Cloudflare Tunnel
   |
Raspberry Pi 5
   |
   +--> Next.js (sole application origin)
          |
          | /api/v1/* internal rewrite
          v
       Fastify API (private service)
          |
          v
       PostgreSQL (HDD)
```

Private administration:

```text
Developer PC --> Tailscale --> SSH --> Raspberry Pi
```

CupMemo users do not need Tailscale.

## Same-origin routing

Prefer one public application hostname.

Conceptually:

```text
https://cupmemo.example/
https://cupmemo.example/api/v1/...
```

The selected public entry point targets Next.js only. Next's existing server-side
rewrite sends `/api/v1/*` internally to Fastify; normal app traffic stays in Next.
Do not add a separate public Fastify origin or duplicate proxy layer.

Fastify remains a separate service even when routed under the same origin.

PostgreSQL remains private.

See [SAME_ORIGIN_ROUTING.md](SAME_ORIGIN_ROUTING.md) for the compiled-origin
contract and executable isolated production transport verification (Refs #41).
Those local controls do not authorize public routing or prove real production
auth/database/HTTPS behavior. The dormant private stack has no ingress.

## Cloudflare Tunnel

Cloudflare Tunnel is **not preinstalled or preconfigured**.

Setting it up is part of the deployment work.

Prefer running `cloudflared` in the production Compose stack unless a strong technical reason suggests otherwise.

Use current official Cloudflare documentation during implementation rather than relying on old commands.

Goals:

- public HTTPS
- no home-router port forwarding
- no public SSH
- no public PostgreSQL
- no unnecessary direct Fastify exposure

Tunnel credentials/tokens are secrets.

Never:

- commit them
- put real values in documentation
- print them unnecessarily in logs

Use environment/secrets configuration and appropriate `.gitignore` rules.

If Cloudflare requires an interactive account/domain authorization step, automate everything else possible and document the exact manual step.

## Environment variables

Expected examples:

```text
NODE_ENV
CUPMEMO_DB_ENV
CUPMEMO_DATABASE_URL_PRODUCTION
BETTER_AUTH_SECRET
BETTER_AUTH_URL
POSTGRES_DATA_DIR
UPLOAD_DATA_DIR
BACKUP_DIR
CLOUDFLARE_TUNNEL_TOKEN
```

Database configuration uses an explicit `CUPMEMO_DB_ENV=production` and `CUPMEMO_DATABASE_URL_PRODUCTION`; it never falls back to `DATABASE_URL`. This names the configuration contract only: it does not authorize production connections, deployment, or storage-path selection. Never commit secrets. Environment-specific filesystem paths and secrets must not be hard-coded in application source.

Commit only example files such as `.env.example`, never production values.

## Pre-deployment Pi audit

See the [historical pre-mount audit](PI_RUNTIME_AUDIT.md#historical-pre-mount-snapshot)
and [current supplement](PI_RUNTIME_AUDIT.md#current-supplement) (Refs #31).
Repository/Docker root and `/mnt/nas-hdd` resolve to SSD; the actual HDD is currently
mounted at `/DATA/nas`. Production target, data directory, ownership/permissions
and fail-closed Issue11 guard remain unapproved; path discovery is not deployment
approval, and the world-writable mount root is not approved PostgreSQL PGDATA.

Before assigning ports or writing production paths:

1. inspect OS/architecture
2. inspect Docker/Compose availability
3. inspect SSD/HDD mounts
4. inspect free space
5. inspect running containers/services
6. inspect occupied ports
7. verify Tailscale connectivity

Do not stop unrelated services merely to obtain a preferred port.

## Current authorized NAS isolation preparation (Refs #11)

The dated audit and preparatory guard observations below are retained history.
The current user decision approves the existing HDD's root0777 ->0755 restrictions
and narrow reserved-cupmemo Samba/Syncthing/known-backup isolation, preserving root
ownership and existing child permissions/content. This resolves that prior
permission question only; no PGDATA/UID provisioning, database startup, public
deployment or startup/restart clearance is granted.

See [NAS_ISOLATION.md](NAS_ISOLATION.md) for the read-only component preflight,
exclusive private SSD candidate preparation, actual source provenance, independently
reviewed owner-only staged rollout/rollback and required client/runtime controls.
The coder/reviewer do not apply live NAS changes. Samba preparatory eligibility
does not mean an installed veto; Syncthing's private managed source may safely
refuse unavailable access. Root rclone dynamic/future backup exclusions remain
UNVERIFIED and block any private database provisioning. No all-isolated PASS or
replacement of the original PostgreSQL guard is implied.

## HDD startup guard (development/preparation only, Refs #11)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/11. Primary HQ card:
`t_9cbb487a`. `infrastructure/scripts/postgres-hdd-guard.mjs` is a Node24 stdlib
**host** preflight and trusted-operator foreground argv launcher. It is not
installed service/Compose wiring or approval to start production PostgreSQL.
Development database defaults are unchanged. No configuration is inferred or
implicitly loaded from `.env`; explicitly supply all four variables:

| Variable             | Required value (no default)                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `POSTGRES_HDD_MOUNT` | Absolute, normalized, nonroot expected filesystem mount root                         |
| `POSTGRES_HDD_UUID`  | Expected ext4 UUID, canonical lowercase `8-4-4-4-12` hexadecimal form                |
| `POSTGRES_DATA_DIR`  | Absolute, normalized, pre-existing strict child of the mount, outside the repository |
| `POSTGRES_DATA_UID`  | Explicit positive decimal POSIX owner UID (not inferred or assumed999)               |

Paths must have no symlink components, traversal or trailing slash. Data must be
owned by the configured UID and have exactly0700 or0750 permissions (no special
bits). Every ancestor from mount root through data must be non-group/world-writable.
The guard does not mkdir, chmod, chown, inspect directory contents or connect to
PostgreSQL. An operator must separately approve/provision safe storage; refusal is
not authorization to modify a shared NAS.

After approval and explicit environment setup, the interface is:

```sh
node infrastructure/scripts/postgres-hdd-guard.mjs --check
node infrastructure/scripts/postgres-hdd-guard.mjs -- <command> [args...]
```

Replace `<command>` locally with a trusted **foreground** command. Do not use a
daemonizing command (including `docker compose up -d`) as evidence of ongoing
protection. The launcher executes literal argv without a shell, preserves stdio
and exit status, and forwards SIGINT/SIGTERM/SIGHUP. If the child ignores termination,
it is killed after2000ms; the wrapper propagates the actual resulting signal.
It does not manage descendant daemons. The trusted child inherits the operator's
environment and can print its own output; never put credentials in argv. Guard
diagnostics are fixed reasons and never echo environment, command argv or raw
filesystem/probe exceptions. Invalid CLI/configuration fails before child launch.

The guard uses `/usr/bin/findmnt` JSON with a2000ms timeout, SIGKILL on timeout and
16KiB output limit per probe. Both mount and data must resolve to the **exact**
expected target, UUID, ext4 type, filesystem root `/` and matching Linux device
major/minor. It refuses root/SSD device fallback, unknown or ambiguous evidence,
nested mounts/subdirectory binds and unsafe/unavailable paths. `lstat`/`realpath`
reject symlinks; a second stat pass checks identity/ownership/modes after probes.
Importing the module has no probing/launch side effects. Test injection exists
only in exported function parameters, never in production CLI environment flags.

### Current refusal controls and evidence limits

The [current audit supplement](PI_RUNTIME_AUDIT.md#current-supplement) identifies
HDD `/DATA/nas`, ext4 UUID `68391fd3-3c92-4cfe-82db-47a5e6abb2ee`.
`/mnt/nas-hdd` resolves to SSD/root UUID `493d6733-2a8b-482b-b39f-a7ecc1ce8863`;
it is not the HDD. `/DATA/nas` is root:root777, unsafe mount ancestry, and the
mount root itself is not valid PGDATA. These remain refused controls, not enabled
production values or a permission-repair instruction. No approved production data
directory, owner UID, permissions or deployment target exists.

Focused verification:

```sh
corepack pnpm exec vitest run tests/postgres-hdd-guard.test.mjs
corepack pnpm exec prettier --ignore-path /dev/null --file-info docs/DEPLOYMENT.md
corepack pnpm exec prettier --ignore-path /dev/null --check docs/DEPLOYMENT.md infrastructure/scripts/postgres-hdd-guard.mjs tests/postgres-hdd-guard.test.mjs
```

Tests use real disposable SSD directories/symlinks/modes and sentinel children,
with explicitly **injected mount-table fixtures** for positive cases. Those are
unit behavior, not a mounted test HDD or positive production launch. Actual bounded
subprocess failure and foreground argv/status/signal controls are exercised.
Real host CLI SSD/root777 refusals and exact-head root quality/CI results belong
in the native implementation/review receipts on the primary card. Checks never
write to the HDD, change mounts/permissions, or start a real database.

### Remaining original acceptance and startup/restart boundary

This preflight has a **check-to-launch race** and is not a hot-unmount lock. A
trusted stable mount and unchanged paths are prerequisites; removal/replacement
after checking is not prevented. A successful `--check` is not a reusable launch
receipt: the launcher performs the same fresh guard itself.

Docker daemon automatic restarts can bypass a host launcher. Future separately
authorized [Issue32](https://github.com/ohjy1006kenneth/CupMemo/issues/32) Compose
and [Issue42](https://github.com/ohjy1006kenneth/CupMemo/issues/42) service wiring
must close **all** startup/reboot/restart bypasses, prevent bind-path auto-creation
(`create_host_path: false` or equivalent), retain private DB networking and verify
actual missing-HDD refusal before production. No Compose/systemd/permission
deployment is delivered by this preparatory artifact.

Original Issue11 acceptance remains separate: actual HDD identity is documented;
data path is configurable; guard/safe fallback refusal are executable artifact
tests; this procedure is documented. **Actual production-path approval and real
PostgreSQL startup/reboot/restart protection remain UNVERIFIED.** Partial artifact
integration must not close Issue11 or finish the same primary card. All12 dependency
advisories, R1 and separate auth-redirect attribution retain the development-only
[Issue30 risk disposition](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6140040612),
not public-production clearance.

## Backups

See [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for the documentation-only
verification/recovery checklist, required private rebuild inventory and five
incident scenarios. Issue #47 automated dumps/retention and Issue #48 actual safe
non-production restore remain incomplete; off-site backups are future follow-up.
The requirements below are targets, not a running backup service or activation
authority. Dormant Compose/startup templates do not establish recovery readiness.

Implement automated PostgreSQL dumps.

Initial retention:

- 7 daily
- 4 weekly
- 3 monthly

Where practical, keep at least one backup copy on storage separate from the live database, such as the SSD.

Document:

- backup command/job
- backup location
- retention
- restore procedure
- verification procedure

Perform an actual safe restoration test before considering backup/recovery complete.

## Reboot/recovery expectations

A normal Pi reboot should result in:

1. required storage mounts available
2. HDD guard passes
3. PostgreSQL starts
4. API becomes ready
5. web app starts
6. cloudflared reconnects
7. public HTTPS becomes healthy

If the HDD is absent, PostgreSQL should remain stopped and the failure should be obvious in logs.

## Future migration

The deployment should not assume the Pi forever.

Possible future moves:

- Next.js -> Vercel/Cloudflare/AWS
- Fastify -> ECS/EC2/Fly/Render/etc.
- PostgreSQL -> RDS/managed PostgreSQL
- uploads -> S3/R2

Do not build those cloud resources during MVP.
