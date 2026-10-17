# Dormant Cloudflare Compose preparation (Refs #44)

Primary `hq/t_c27c68da`, original implementer `code-monkey-cupmemo`, native
run3328. **Source/config/test preparation only, not deployment.** Keep Issue #44
and its primary card unfinished until separately authorized setup and actual
normal connector restart/availability evidence pass. [DEPLOYMENT.md](DEPLOYMENT.md)
remains the operator entry point; its Issue #46 real restart drill is UNPERFORMED.

## Optional overlay and fixed boundary

`infrastructure/docker/cloudflare.compose.yml` is a separate optional overlay for
`production.compose.yml`. It adds one service, `cloudflared`, under opt-in profile
`tunnel`. The base remains exactly three services; the private startup wrapper,
HDD guard and uninstalled systemd template are unchanged and **do not supervise a
connector**. No start/restart command or live activation interface is supplied.
A profile is convenience, not an authorization boundary: explicitly targeting a
service can activate its profile automatically.

The connector joins existing internal `frontend` and a new project-local,
non-internal `tunnel-egress` network. Only the connector joins `tunnel-egress`;
web/API/PG memberships and internal `frontend`/`backend` definitions are unchanged.
No external/shared network, host networking, published port, Docker socket, proxy
or new public API route is added. Future reviewed remote routing must send the
single public application hostname to `http://cupmemo-web:3101` only. Next's
[compiled rewrite](SAME_ORIGIN_ROUTING.md) then uses private Fastify4101 and HDD
PostgreSQL17. Sharing frontend also permits connector-to-API network reachability;
it is **not** an L3 connector/API isolation guarantee. Do not publish that API.
Source membership does not prove runtime reachability, egress or firewall isolation.

The service retains the official image entrypoint and replaces its default
`version` command with exec-form `[tunnel, run]`. No shell, curl, wget or synthetic
healthcheck is assumed. No token literal, tunnel UUID, account, domain, hostname or
replica topology is selected. Remote route configuration remains held separately.

## Explicit nonsecret inputs and secret mapping

| Input                          | Required selection, no default                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUPMEMO_CLOUDFLARED_IMAGE`    | Official `cloudflare/cloudflared@sha256:<64 lowercase hex>` (optional `docker.io/` prefix); independently verify immutable manifest, linux/arm64, version2025.4.0+ and compatible entrypoint. |
| `CUPMEMO_CLOUDFLARED_UID`      | Explicit verified positive decimal UID1–2147483647, no leading zero; used as the same numeric UID:GID, never inferred from the image or host.                                                 |
| `CLOUDFLARE_TUNNEL_TOKEN_FILE` | Absolute normalized nonroot external file path, no trailing slash/control characters, outside the repository including its worktrees. It is a path, **not the token value**.                  |

The external file is the Compose file-secret `cloudflare_tunnel_token`, granted
only to cloudflared at read-only `/run/secrets/cloudflare_tunnel_token`.
Container environment `TUNNEL_TOKEN_FILE` points to that internal path, invoking
the native remote `--token-file` interface. `CLOUDFLARE_TUNNEL_TOKEN` in deployment
expectations remains a **SECRET PLACEHOLDER**, not a raw-value adapter. Neither
`TUNNEL_TOKEN` nor token-value argv/environment/config secrets are supported by
this candidate. Do not confuse tunnel tokens with management API tokens,
`cert.pem` or locally managed credentials JSON.

No real secret file is read or created in this pass. Store eventual credentials
outside Git under separately approved private custody. `.env`/`.env.*`,
`.cloudflared/` and files named `cloudflare_tunnel_token` are Git-ignored as
accidental-copy defenses, not an encrypted store or exhaustive secret detector.
Do not put any real secret in `.env.example`, other source or arbitrary filenames.
Standalone Compose file secrets are bind mounts, not encrypted platform secrets;
file-backed `uid`/`gid`/`mode` cannot be relied upon to remap host ownership.
Future independent activation checks must verify safe ancestors, no symlink
substitution, owner/mode and readability by the **selected** nonroot UID/GID,
plus selected image compatibility with a read-only root. This source chooses no
host UID, provisioned path or installed image and proves none of those properties.
Token rotation does not rotate Better Auth secrets, DB passwords or user sessions.

## Dormancy and provisional ceilings

`platform: linux/arm64`, `pull_policy: never`, `restart: 'no'`, read-only root,
`cap_drop: [ALL]`, no-new-privileges, CPU0.25, memory64MiB, memory-swap64MiB and
pids64 are explicit source controls. json-file logs are bounded to10MiB x3.
These are **provisional source ceilings**, not measured capacity, secret-safe
logs, automatic recovery, zero downtime or proof of engine enforcement. No build,
automatic image pull, persistence or installed connector supervisor is supplied.
A successful schema render does not guarantee image provenance/version/availability,
secret readability, network isolation, full-stack Pi coexistence or restart safety.

## Actual offline checks and limits

From the repository root, with the pinned dependencies already installed:

```sh
corepack pnpm exec vitest run tests/cloudflare-compose.test.mjs tests/production-compose.test.mjs tests/private-stack-start.test.mjs --maxWorkers=1 --no-file-parallelism
corepack pnpm exec eslint infrastructure/scripts/cloudflare-compose.mjs tests/cloudflare-compose.test.mjs
corepack pnpm exec prettier --ignore-path /dev/null --check infrastructure/docker/cloudflare.compose.yml infrastructure/scripts/cloudflare-compose.mjs tests/cloudflare-compose.test.mjs docs/CLOUDFLARE_COMPOSE.md docs/DEPLOYMENT.md docs/PRIVATE_COMPOSE.md
```

Tests execute installed `docker compose config --format json` against a deliberately
absent Docker socket, empty explicit interpolation file and isolated environment.
Only disposable SSD fixtures with NONSECRET placeholders are used. Both password
and tunnel-token paths are deliberately nonexistent: rendering reads neither
secret. The base API env file is a synthetic nonsecret fixture only. No daemon,
image pull/build/start, real credential access, real hostname probe or database is
involved. Expanded models stay in memory, never in retained logs/artifacts.

`infrastructure/scripts/cloudflare-compose.mjs` exports two pure functions only:
`verifyCloudflareInputs` checks exactly the three inputs above (unknown keys and
raw-value credential inputs fail); `verifyCloudflareModel` checks the actual
merged model against the unchanged base plus only the specified connector,
network and file-secret. It rejects ports, network/restart/resource/entrypoint
changes, credential-value delivery and unrelated additions. There is no launch
CLI, environment loading or file access. Compose interpolation itself only
refuses missing/empty inputs: it does **not** run these stricter checks. Tests
include actual schema-valid unsafe overlay rejection and missing/empty/untrusted
image/path/UID controls. Do not mistake this helper for a production admission
wrapper; future activation still needs an independently reviewed exact-resource
interface and fresh real evidence.

## Still held; source rollback

All [private activation gates](PRIVATE_COMPOSE.md#still-held--unverified-before-any-activation)
and [recovery gates](DISASTER_RECOVERY.md) remain. Account/token/tunnel/DNS changes,
public activation, real credential inspection, PGDATA, DB starts/migrations,
Docker daemon/image operations and NAS/shared-runtime changes are not authorized.
No runnable start/restart recipe may be inferred from this source. Future owner
authority must identify exact resources and operation/rollback, verify image and
nonroot file compatibility, approve connectivity/routing, and supply real before/
during/after normal restart, HTTPS/web/API/auth and session-continuity receipts.
Source/fixture/hosted CI PASS is not live recovery. Independent LIGHT exact-head
technical review then owner partial acceptance/integration are required; there is
no UI delta. Rollback is a reviewed revert of this overlay/helper/test/guidance
and narrow ignore changes only; no live resources exist to stop or remove.

## Official references consulted

- [Cloudflare run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/): remote `token-file` / `TUNNEL_TOKEN_FILE`, version2025.4.0+.
- Official source commit `8e090e5bfa7a53e824fb2d7eb276f8ab08337b80`: [Dockerfile](https://github.com/cloudflare/cloudflared/blob/8e090e5bfa7a53e824fb2d7eb276f8ab08337b80/Dockerfile), [ARM64 build](https://github.com/cloudflare/cloudflared/blob/8e090e5bfa7a53e824fb2d7eb276f8ab08337b80/Dockerfile.arm64), [native token flags/read](https://github.com/cloudflare/cloudflared/blob/8e090e5bfa7a53e824fb2d7eb276f8ab08337b80/cmd/cloudflared/tunnel/subcommands.go). Distroless nonroot image; entrypoint `["cloudflared", "--no-autoupdate"]`, default command `["version"]`. This is public interface evidence, **not a selected/installed image or digest attestation**.
- Docker [config rendering](https://docs.docker.com/reference/cli/docker/compose/config/), [profiles](https://docs.docker.com/compose/how-tos/profiles/), [networks](https://docs.docker.com/reference/compose-file/networks/), [file secrets](https://docs.docker.com/reference/compose-file/secrets/) and [service secret mounts/ownership limitation](https://docs.docker.com/reference/compose-file/services/#secrets).

Recheck selected immutable image metadata and current official guidance at future
authorized activation. Upstream installer/token examples are not CupMemo commands.
