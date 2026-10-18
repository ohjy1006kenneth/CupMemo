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

### Operations status and authority (Refs #46)

The Issue #46 runbook below is **documentation preparation only**, primary `hq/t_8e64e3a6`, original
implementer `code-monkey-cupmemo`, native run3325. No account, domain, hostname,
tunnel UUID, connector, token, installed CLI or running service is selected or
verified here. Issue #43 setup, #44 live connector/service acceptance and #45 real
public HTTPS/web/API/auth acceptance remain outstanding. Issue #46 and its primary card
must remain unfinished after partial documentation integration: recovery after a
normal service restart is **UNPERFORMED**, not proven by fixtures or hosted CI.

The current [private Compose](PRIVATE_COMPOSE.md) source defines only web, API and
PostgreSQL, with no ingress, no published ports and `restart: 'no'`. Its two
internal networks do not establish connector egress or origin reachability.
Issue #44 adds a **separate optional dormant** [Cloudflare overlay](CLOUDFLARE_COMPOSE.md)
with profile `tunnel`, connector-only project-local egress and native token-file
mapping. The base remains unchanged. No image/account/tunnel/UID is selected;
source/config/test preparation is not live setup, actual reachability or restart
acceptance. No runnable connector start/restart interface is delivered.
`infrastructure/scripts/private-stack-start.mjs` accepts only `--start`; it has
no stop/restart interface and does not include cloudflared. The uninstalled
`infrastructure/systemd/cupmemo-private.service.in` template has `Restart=no`,
no enablement and no deployed service identity. It is not a supervisor. Do not
invent a `cloudflared.service`, change restart policy or use a blanket stack
start/restart as an operational shortcut.

Every operational action below is a **future conditional checklist**, not a
command to run now or authority to deploy. Obtain explicit exact-resource owner
authorization first. Preserve Issue #11/#32/#42 HDD/privacy/startup gates: fresh
device/UUID/ext4/ancestry/UID/permission verification, no SSD fallback, no bind
auto-creation, and separate PGDATA/database/migration authority. Guard-before-launch
has check-to-launch/hot-unmount limits; direct Docker/manual/daemon restarts can
bypass it, and killing a wrapper does not prove daemon-side containers stopped.
Do not restart shared Docker, the Pi, Hermes or unrelated services to fix a tunnel.
See [PRIVATE_COMPOSE.md](PRIVATE_COMPOSE.md#still-held--unverified-before-any-activation)
and [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for unresolved private storage,
backup and recovery gates. Issue #47 dumps/retention, #48 actual restore and
off-site recovery are not delivered by this guide; no new alert policy is assumed.
The separate [backup engine](POSTGRES_BACKUPS.md) now supplies executable source,
retention and dormant daily UTC templates, not installed/scheduled production
dump acceptance or permission to activate them.

### Future hostname, DNS and private origin mapping

Under separately authorized Issue #43/#45 work, the account/domain owner must
manually sign in to the correct Cloudflare account, confirm their permissions,
add/verify the selected domain and complete any required registrar/nameserver
authorization. No account login, domain transfer or DNS mutation is authorized
by this pass. Follow the current official [dashboard setup][cf-setup] and
[permissions][cf-permissions] documentation rather than guessing dashboard labels.
Record actual identities privately, never fabricate them from examples.

For a remotely managed tunnel, the future owner selects the tunnel under
**Networking > Tunnels**, then **Routes > Add route > Published application**,
selects the authorized hostname/domain and service URL, and reviews the change
before publishing. This exposes an application to the Internet; it is not an
innocuous DNS-only change. The intended single hostname maps **all application
paths to Next**, conceptually `http://cupmemo-web:3101` from a future connector
with reviewed private reachability. This is an existing service address, not a
currently reachable tunnel endpoint. Inside a separate connector container,
`localhost` refers to that container, not Next or the Pi.

Next's compiled `/api/v1/:path*` rewrite targets `http://cupmemo-api:4101`, then
Fastify uses private PostgreSQL17. Preserve [compiled routing](SAME_ORIGIN_ROUTING.md)
and [image inputs](CONTAINER_IMAGES.md#network-and-configuration-boundary): a
runtime variable change cannot retarget the compiled rewrite. Do not add a second
public API hostname, a Fastify path route, a new proxy, router port forwarding or
public SSH/DB/API ports. The dormant [Issue #44 source contract](CLOUDFLARE_COMPOSE.md)
defines frontend plus connector-only egress, required official immutable ARM64
image/version inputs and `restart: 'no'`; actual image/identity selection and
runtime connectivity/restart acceptance remain held.

Official [DNS guidance][cf-dns] describes a CNAME pointing the approved hostname
to the tunnel's generated `<UUID>.cfargotunnel.com` target (a format placeholder,
not an actual UUID). Verify the actual account environment's target, hostname,
proxy state, existing record conflicts and certificate coverage before change;
multi-level subdomains may require additional certificate coverage. A DNS record
can outlive a stopped tunnel, and correct DNS does not prove a connector or app
is healthy. Dashboard-published routing and DNS must refer to the same approved
tunnel. The locally managed `cloudflared tunnel route dns` interface requires
account certificate authority and mutates DNS; it is **not** a token-only remote
tunnel diagnostic or a command to use here.

### Future approved start, stop and restart checklist

1. Record the maintenance owner, authorization/window, actual tunnel/connector
   identities, hostname, release commit/tree, immutable image identities and exact
   owned service/container resources privately. Establish the Issue #43/#44 setup
   receipts and Issue #45 public/auth baseline. Identify surviving resources before
   retrying interrupted actions. Unknown ownership or state means STOP.
2. Agree the operation: connector-only start/stop/restart, or a separately approved
   wider app operation. A connector restart must not implicitly start/recreate the
   DB or rest of the stack. For wider work, re-establish all HDD/privacy/backup and
   database authority gates above, including data-persistence and rollback checks.
   A prior successful guard or config render is not reusable launch clearance.
3. Have Issue #44 supply the reviewed exact command for the selected supervisor,
   explicit project/file/context and single owned connector service or container,
   trusted external secret delivery and bounded graceful-stop timeout. **No such
   operational command is implemented in this repository yet.** Do not substitute
   generic `docker compose up`, `restart`, `down`, `docker restart` or host service
   commands; they may bypass guards or affect unrelated resources. Do not install
   the official system service example in parallel with the preferred future
   Compose connector. Preserve the current `restart: 'no'` source limits.
4. Before start, verify authorized local artifacts/config custody and reachable
   private Next plus approved outbound Cloudflare connectivity. Before stop,
   record baseline health/auth and expected outage. Stop only the identified
   connector, allow approved graceful draining and confirm its actual exit and
   remaining connectors. A replica may keep traffic up; do not assert an outage
   merely because one connector stopped. Never delete the tunnel or DNS to stop it.
5. Start only through the approved future interface. For restart, perform the
   selected supervisor's normal service restart, not a substitute process kill,
   and capture actual stop/start results. Cloudflare's [run parameters][cf-run]
   describe SIGINT/SIGTERM draining with `grace-period`; reconcile the chosen
   supervisor timeout with it before execution, without changing policy here.
6. Verify new connector connections, unchanged route/DNS, Next and API behavior,
   HTTPS and auth using the drill below. A running container or Healthy tunnel is
   not application recovery. On failure, preserve evidence and use the approved
   exact-resource rollback; never prune/delete volumes, reinitialize PGDATA,
   change the bind, auto-migrate or restart other workloads. Reconcile daemon-side
   resources before retry. No rollback to compromised credentials is allowed.

### Layered health and bounded private log inspection

After separate inspection/probe authority, diagnose from the outside inward using
the actual approved hostname and private resource inventory. No real hostname
probe or local service/DB inspection is performed by this documentation task.

| Layer                   | Evidence and limit                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS and HTTPS           | Verify approved DNS route/target and public certificate/hostname/expiry. Public HTTPS terminates at Cloudflare; a private HTTP Next service URL is not a reason to disable public TLS validation. DNS/TLS failure precedes app diagnosis.                      |
| Cloudflare connector    | Check the selected tunnel and each connector in the dashboard. Healthy concerns connector-to-edge connections, not Next, DB or auth. Inactive means never connected; Down means disconnected; investigate Degraded connections.                                |
| Next origin             | From the approved connector network, verify service name, port3101, protocol and `/sign-in` response/static assets. No current host port is published. A tunnel502 can mean the connector cannot reach this origin even when it is connected to Cloudflare.    |
| Next-to-Fastify         | Through the same hostname, `/api/v1/health` exercises routing to API liveness. Fastify's private `/health` is also liveness only. Public `/health` or `/ready` is not a Next rewrite to Fastify; only `/api/v1/*` is rewritten.                                |
| DB readiness and schema | Private API4101 `/ready` runs `SELECT 1`, returning200/503, not schema/migration/auth proof. PG `pg_isready` is server availability, not password validation. Use separately authorized status/schema/data checks; never run migrations to make a probe green. |
| Auth and private data   | Test actual public origin, sign-in/session, Secure/HttpOnly/Lax cookies, no-store, sign-out and owner-only access. Liveness and anonymous HTML do not prove authenticated flows or persisted data. Never weaken CSRF/origin/cookie checks to bypass failure.   |

Use [Cloudflare common errors][cf-errors] and [tunnel logs][cf-logs] alongside
this layering. Once a future service exists and private inspection is authorized,
the operator may select bounded logs for **one verified owned container** using
the official [Docker logs](https://docs.docker.com/reference/cli/docker/container/logs/)
interface shape `docker logs --since 10m --tail 100
<owned-container-id>`; the ID is an unselected placeholder, not runnable here.
Use the approved explicit Docker endpoint/context; do not inspect all workloads.
For an explicitly approved host-service alternative, journal filtering must name
that exact installed unit and bound time/lines; no unit name is supplied here.
Cloudflare dashboard log streams also require access and an active tunnel; an
unavailable remote stream does not prove absence of local failure.

Review logs only in private, bounded storage with restricted access. Capture
timestamps/timezone, exit codes and sanitized phase/error category, not raw request
or config dumps. Never retain expanded Compose JSON, `docker inspect` environment,
`printenv`, credential files, token-revealing installation commands/process argv,
auth headers, cookies, query bodies, personal data or raw diagnostic bundles in
Git/issues/PRs. Even ordinary status output can include argv or recent logs.
Cloudflare debug logging can expose full request/response headers; do not enable
it casually. `--logfile` does not rotate by itself. Existing app Compose log
rotation is not proof of secret-safe logs or a selected connector logging policy.
Before sharing, manually redact secrets/private identities and retain originals
only under approved private custody; if exposure occurred, treat it as compromise.

### Common failures and safe next steps

| Symptom                                             | Distinguish before an authorized fix                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS conflict, resolution error or TLS mismatch      | Confirm the approved zone/account/hostname, existing records, generated tunnel target and certificate coverage. Do not replace DNS, disable TLS or open router ports as a diagnostic shortcut.                                                                                                                   |
| Tunnel1033, Inactive, Down or Degraded              | Inspect exact connector state and bounded logs, approved outbound DNS/network connectivity (official setup calls out port7844), token validity and process exit. No connector-to-edge connection is distinct from a live connector with a bad origin. Do not change shared firewall rules here.                  |
| Cloudflare502 / origin connection refused           | Verify Next is actually listening on private3101, reachable from connector networking, and service URL protocol/port/name match. A separate container's loopback is not Next. Do not expose Fastify or disable origin TLS verification as a workaround.                                                          |
| Next page works, API500/503 or saves fail           | Check compiled rewrite/private Fastify4101, API readiness, DB connectivity and schema status separately. Preserve HDD refusal and investigate unavailable DB/storage without starting a replacement or SSD fallback.                                                                                             |
| Sign-in loop, missing session or forbidden mutation | Check exact approved `BETTER_AUTH_URL` HTTPS origin, browser cookie attributes, same-origin request path, cache behavior and trusted Origin. Never publish cookies or rotate auth secrets merely to fix a tunnel.                                                                                                |
| Connector authentication failure                    | Distinguish remote tunnel token from local certificate/JSON credentials and Cloudflare management API token. A refreshed/revoked old token cannot establish new connections; an old existing connector may still be active. Follow the rotation procedure, not repeated blind starts.                            |
| Restart exits, refuses or fails to recover          | Record actual exit/refusal, source/image/config identity and surviving connectors/containers. Missing storage or unknown authority stays STOP; `restart: 'no'` intentionally supplies no automatic recovery. Preserve failed receipts and escalate scope rather than bypassing the wrapper or restarting Docker. |

### Credential custody, rotation and compromise

`CLOUDFLARE_TUNNEL_TOKEN` is the repository's expected **SECRET PLACEHOLDER**,
not a working token or implemented Compose input. Cloudflare's [official run
parameters][cf-run] use `TUNNEL_TOKEN`, or `TUNNEL_TOKEN_FILE` / `--token-file`
(remote tunnels, version2025.4.0+). The optional [Issue #44 overlay](CLOUDFLARE_COMPOSE.md)
requires external **path** `CLOUDFLARE_TUNNEL_TOKEN_FILE`, mounts Compose secret
`cloudflare_tunnel_token` read-only at `/run/secrets/cloudflare_tunnel_token`, and
sets native `TUNNEL_TOKEN_FILE` to that internal path. It does not implement a
raw-value `CLOUDFLARE_TUNNEL_TOKEN` adapter or select/create/read a credential file.
Selected image/version and nonroot owner/readability need future independent
verification. Avoid token literals in argv, shell history and logs. Store any
future real secret outside Git under approved least-privilege custody, with
restricted ownership/readability and a separately recoverable private inventory.
Anyone possessing a remote tunnel token can run a connector for that tunnel.

Do not conflate a remote tunnel token with a Cloudflare API management token,
locally managed per-tunnel credentials JSON or the broader account `cert.pem`.
Do not run local `login`, create, route or certificate-renewal commands to repair a
remote token. Management credentials need their own scoped permissions/custody;
no API token is provisioned here. Follow the official [token rotation and
compromise guidance][cf-permissions] under explicit owner authorization:

1. Inventory every authorized connector and its exact tunnel, secret location and
   maintenance/rollback owner privately; assess suspected exposure and affected
   access. Preserve sanitized incident evidence without copying the secret into
   tickets. Obtain authority for credential update, connector restarts and outage.
2. In the correct tunnel's dashboard **Overview > Refresh token**, the authorized
   account owner refreshes the token and transfers the new value directly into
   approved private secret custody. Do not execute/copy the token-bearing installer
   into shell history or publish its output. Refresh invalidates the old token for
   **new connections**, but existing connectors remain active; refresh alone is
   not eviction or full compromise containment.
3. For routine rotation, update each exact owned connector's approved external
   secret and apply the separately reviewed service update/recreation procedure.
   A plain restart may not reread changed environment configuration. Cloudflare's
   minimal-disruption procedure assumes at least two replicas, updates half,
   verifies connections, waits 10 minutes for traffic routing, then repeats for the
   rest. This Pi has no selected replica topology; do not claim zero downtime or
   create replicas. With a future single connector, plan an approved outage.
4. For compromise, Cloudflare recommends refreshing the token, **deleting all
   connections for that exact tunnel** through its documented management API,
   then updating all authorized replicas to the new token. This is a disruptive
   privileged action requiring explicit exact-tunnel authority; do not delete the
   tunnel/DNS or affect another tunnel. Old unauthorized active connections must
   be removed, not left serving merely because the new token works.
5. Verify each intended new connector and absence of old/unauthorized connections,
   then the actual hostname/HTTPS/web/API/auth baseline. Confirm old-token
   invalidation through trusted management state without printing or launching an
   old credential as a test here. Remove superseded copies from approved secret
   delivery/custody after owner verification and record nonsecret completion
   receipts. API/certificate compromise requires its own scoped revocation plan.

Tunnel-token rotation does **not** rotate `BETTER_AUTH_SECRET`, database passwords
or user sessions. Preserve the auth secret for session continuity unless a separate
security decision authorizes rotation and its session impact. Never silently
restore an exposed token as rollback; use a new approved credential and retain the
incident until containment and application verification are actually complete.

### Real restart drill and required receipts — UNPERFORMED

No tunnel/service restart, DNS/account change, real public request, DB start or
data mutation has been performed for this documentation. Hosted CI and any
synthetic/local routing controls cannot satisfy this live acceptance criterion.
After explicit authority and actual Issue #43/#44 setup plus #45 availability/auth
tests, use this same Issue #46/card for the real normal-service-restart drill:

- **Before:** retain authorization, maintenance window/timezone, actual approved
  hostname/tunnel/connector/service identity, exact release commit/tree, immutable
  artifacts and reviewed operation/rollback command identities in private receipts.
  Verify storage/privacy/backup/data-persistence gates and known owned resources;
  no #47/#48/off-site success may be assumed. Establish real HTTPS certificate,
  Next page/assets, `/api/v1/health`, separately approved private readiness/schema,
  sign-in/session and known owner-only saved brew read baseline outside Tailscale.
  Any write fixture requires explicit authority and private test-data custody.
- **During:** record the actual normal restart invocation, start/end timestamps,
  supervisor exit/result and old/new connector identities/connections; observe
  bounded requests through the actual hostname. Record actual outage or continuity
  (including other replicas), not a promised duration. Preserve sanitized failures.
  Do not reboot the host, restart DB or alter DNS/credentials as part of a
  connector-only restart drill.
- **After:** verify reconnection and stable repeated HTTPS/web/API responses at
  the same hostname, auth session continuity and fresh sign-in/sign-out, owner-only
  saved data and persistence. If separately approved wider services restarted,
  also verify fresh HDD guard and actual data persistence across those restarts;
  connector-only recovery proves neither DB-restart nor Pi-reboot safety. Check
  bounded private logs and unchanged routes/artifacts/resources. Missing evidence,
  bypassed gates or any failure means FAIL/UNVERIFIED, never documentation PASS.
- **Receipt/decision:** retain original private logs and redacted checks with
  exact actions/resources/artifacts, before/during/after outcomes, observed recovery
  duration, rollback result if used, residual failures and independent review/owner
  acceptance. If recovery fails, reconcile partial effects and use only approved
  exact-resource rollback preserving data and unrelated workloads. Only the owner
  may accept the whole outcome or close Issue #46/card after real evidence.

### Official operational references

These public Cloudflare sources were consulted for this documentation; recheck
them and the selected installed version during future authorized implementation.
Their installer/sudo/token examples are **not CupMemo activation instructions**.

- [Dashboard setup, domain prerequisite and published application route][cf-setup]
- [DNS records, tunnel target and local-management distinction][cf-dns]
- [Run parameters, token-file, graceful shutdown and sensitive logging][cf-run]
- [Tunnel states and common origin/connection failures][cf-errors]
- [Local and remote tunnel log streams][cf-logs]
- [Token permissions, routine rotation and compromised-token containment][cf-permissions]

[cf-setup]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
[cf-dns]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/
[cf-run]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
[cf-errors]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/
[cf-logs]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/logs/
[cf-permissions]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/

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
Those dated observations resolved repository/Docker root and `/mnt/nas-hdd` to SSD
and the HDD to `/DATA/nas`. Their unapproved-target/root0777 statements describe
the historical audit, not current authority or a fresh host-state assertion.
The Pi target and narrow NAS restrictions are now approved as described below;
PGDATA path/UID provisioning, database startup and public deployment remain held.

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

### Samba durability source-publication checkpoint

The [CasaOS Samba source bundle](../infrastructure/casaos-samba/README.md) publishes
the immutable pinned upstream patch, public provenance lock, minimal original
patch-application fixtures and actual offline materialized-adapter regression.
The accepted separate ARM64 manager build exited0 and independent affected Go
tests passed10 top-level +52 subtests; the binary has never been executed or
installed. Historical resource sampling exceeded the literal100ms condition:
artifact validity was accepted, not full resource compliance or hard memory
isolation. This publication performs no new manager compilation or live rollout.

The writer retains protected owner-managed nas even with zero rows, while preserving
ordinary sections; source/tests are not installed enforcement. Current-state
canonical policy/root/include/manager hashes, safe storage, alias/mount identity,
real generation/create/delete/reload and exact rollback still need separately
reviewed live impact and owner authorization. Stock rollback restores a known
durability gap. Syncthing per-app updates and unrestricted root rclone RC remain
independent unfinished privacy gates. No PGDATA-ready or whole-outcome PASS follows
from source integration, the closed GitHub Issue11, or integrated32/42 templates.

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

### Historical refusal controls and evidence limits

The [dated audit supplement](PI_RUNTIME_AUDIT.md#current-supplement) identified
HDD `/DATA/nas`, ext4 UUID `68391fd3-3c92-4cfe-82db-47a5e6abb2ee`.
`/mnt/nas-hdd` resolves to SSD/root UUID `493d6733-2a8b-482b-b39f-a7ecc1ce8863`;
it is not the HDD. The original root:root777 observation was unsafe mount ancestry;
that refusal receipt remains historical, not a fresh permission observation.
The mount root itself is never valid PGDATA. The Pi target and narrow root0755
restriction are now approved, not production launch values or a repair instruction.
No PGDATA directory or production owner UID has been provisioned or authorized
by this source-publication checkpoint. Fresh guard/privacy/authority checks remain
mandatory before any future separately authorized launch.

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

### Pinned AppManagement source/build checkpoint

The [pinned AppManagement source bundle](../infrastructure/casaos-appmanagement/README.md)
distributes the Syncthing CURRENT/effective-CANDIDATE mutation admission patch,
minimal original offline fixtures and actual service/helper tests. Its separate
hosted ARM64 reproduction lane requires verified effective hard cgroup limits;
do not compile/run the manager or Docker build on the shared Pi. Build receipts
bind the exact publication head; artifact existence is not independent review or
deployed privacy protection. The source now guards the four registered legacy v1
update/uninstall/archive/terminal triggers using inspected CURRENT plus effective
update CANDIDATE before writers, async success or WebSocket upgrade/exec. Actual
service and shared-handler httptest controls use injected writers/terminal
continuation, not a live Docker mutation or interactive session. Neither manager is installed or executed by this
source publication. Live rollout/rollback, aliases/custody, ordinary-project impact
and root-RC coverage remain unverified. The reachable v2
`recreateContainerByID` path now synchronously admits inspected CURRENT before
scheduling/HTTP200 and rechecks it at service entrance before optional image
staging. HTTP200 means scheduled only: a protected effective image candidate
produces sanitized asynchronous failure before container effects, not retroactive403.
An immutable deep-copied clone plan binds old-default removal/runtime overrides
plus target-image default labels and the inspected target image ID; actual creation
never resolves the tag again. Real helper/orchestration/clone/httptest controls use
injected Docker dependencies, not deployed daemon evidence. Background work is
bounded10minutes with reads3s. Recreation-only registry challenge/token/digest
requests propagate cancellation through response-body close, with3s request/body
limits; initial/final staging image inspections also have3s child contexts. Registry
failure refuses before pull/forced clone rather than using the unrelated legacy
fallback. Controlled in-process transport/body-stall regressions and fake Docker
inspection cancellation are offline tests, not live registry/daemon evidence.
The strict recreation-only Docker pull adapter now propagates daemon JSON errors,
malformed/truncated/empty streams, read failures and cancellation instead of using
the legacy void progress callback. Streaming caps are1MiB per message/64MiB total,
with3s headers/blocking reads and owned-body cancellation/cleanup. The transitive
native credential helper is context-bound too; legacy callers are unchanged.
Actual Docker-client/consumer/staging/forced-recreation tests use a test-tag-only
private transport bridge, no daemon/listener or production override; normal full
build excludes the bridge. All affected offline Go tests must pass before the
single owner-authorized B2 revision full build4. None of this is live approval.
External daemon/root races, nonidentity image effects
and ordinary-project/live rollback behavior remain separate gates.
PGDATA provisioning, database startup and
public deployment remain held; primary outcome and privacy readiness remain false.

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
