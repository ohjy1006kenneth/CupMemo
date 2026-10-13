# Read-only Pi runtime audit (Refs #31)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/31. Primary HQ card:
`t_95163d0d`, board `hq`, tenant `cupmemo`. Original implementer:
`code-monkey-cupmemo`, run2785. The [owner contract](https://github.com/ohjy1006kenneth/CupMemo/issues/31#issuecomment-6140325766)
authorizes observation and documentation only, not deployment.

## Decision boundary

**The original actual-SSD/HDD-path criterion remains UNVERIFIED.** The checkout's
SSD mapping is known, but `/dev/sda1` has no observed mount and no approved production
HDD path or target exists. A reviewable negative audit is not completion of Issue31
or production approval. Owner may integrate partial discovery with `Refs #31` and
keep this SAME Issue/card unfinished for storage/target decisions.

- **OBSERVED** means a successful dated local read, not a future guarantee.
- **PROPOSED** means a conditional naming/network plan, not installed configuration.
- **UNVERIFIED** means absent evidence or an unmet criterion, never PASS.
- **HUMAN-GATED** means owner authorization is required before any mutation.

Earliest incomplete milestone is Phase3 [#11](https://github.com/ohjy1006kenneth/CupMemo/issues/11),
the HDD fail-safe startup guard. This audit is its discovery prerequisite, not
permission to skip it. Phase7 #27–30 are integrated; milestone counters are not
execution evidence. Project state in the owner contract is development/review,
`deployment_target=null`, not an approved production host designation.

The historical pending language in [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)
is superseded for development acceptance by [Issue30 final acceptance](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6140193915)
and [owner risk disposition](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6140040612).
All12 advisories (6 High/5 moderate/1 low), historical R1 and separate auth-redirect
attribution remain development/review/preparation-only debt, **not production/public
security or reliability clearance**. No audit upgrade or functional replay occurs here.
Canonical private-web PRODUCT/MVP_FLOW/ARCHITECTURE govern; reference-only
OCR/community/native-client claims add no audit requirements.

## Observation identity and evidence

Observation window: **2026-10-13T02:15:50-05:00**, command-level timestamps in the
original JSON logs. Timezone is the host's reported offset, not inferred from the
agent UI. Clean native checkout `/home/juyoungoh/CupMemo/.worktrees/issue-31`, branch
`wt/t_95163d0d`, was fetched and fast-forwarded before editing to approved baseline
`f011de84203e3bd73e3dd493499e796f67939e60`, tree
`25015cd4baab8c13835c8ca801a56ec8fc20b8db`. No other checkout was reset or edited.
The enclosing final candidate commit/tree, CI and document hashes belong in the
external immutable implementation receipt, not a self-invalidating hash here.

Evidence locator: native attachments on primary HQ card `t_95163d0d`. The
implementation ZIP contains `IMPLEMENTATION.md`, `probes.py`, original numbered
JSON logs, additional checks and sanitized preflight diagnostics. Every probe log
records timestamp, exact argv, status, stdout and stderr; the external manifest
records each member's bytes/SHA256/CRC32 and stored archive verification. Numbered
filenames below are relative to the archive. Raw Tailscale JSON was parsed only in
memory; peer identities, logins, endpoints and auth/config were never retained.
`os-release.json` records the nonsecret file-tool read separately.

## OBSERVED: platform and resources

| Check / command                                                | Observation                                                                | Status / evidence                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `date -Is`; `uname -m`                                         | 2026-10-13T02:15:50-05:00; aarch64                                         | exit0; `01-date.json`, `02-arch.json`                                         |
| File read `/etc/os-release`                                    | Debian GNU/Linux13 (trixie), full version13.4                              | readable; `os-release.json`                                                   |
| Nonsecret `/proc/device-tree/model` read, trailing NUL removed | Raspberry Pi5 Model B Rev1.1                                               | exit0; `06-model.json` (file tool classified NUL-containing source as binary) |
| `lscpu`                                                        | 4 online Cortex-A76 CPUs, max2400MHz                                       | exit0; `03-cpu.json`; no stress test                                          |
| `free -h`                                                      | RAM7.9Gi total,5.1Gi used,2.7Gi available; swap2.0Gi total/used,832Ki free | exit0; `04-memory.json`                                                       |
| `uptime`                                                       | Up2 days19:01; load0.47/0.36/0.36                                          | exit0; `05-load.json`; not a capacity benchmark                               |
| `docker version --format '{{.Server.Version}}'`                | Server29.4.2                                                               | exit0; `07-docker-version.json`                                               |
| `docker compose version`                                       | v5.1.3                                                                     | exit0; `08-compose.json`                                                      |
| `docker info --format '{{.DockerRootDir}}'`                    | `/var/lib/docker`                                                          | exit0; `09-docker-root.json`; no full inspect                                 |

**Coexistence risk:** a low instant load is not spare sustained capacity. Swap is
almost exhausted, only2.7Gi RAM is available, and root is97% used. Builds, image
layers, logs and backups can compete with Hermes and existing workloads. No
installation, build, pull, browser matrix, stress test, new fixture/container/volume,
recursive disk scan or cleanup was performed for this documentation pass. Existing
project-local Prettier is used without installing dependencies. Capacity remediation
requires an owner-approved, separately bounded decision; never prune or delete
other outcomes' retained evidence to make room.

## OBSERVED / UNVERIFIED: storage

| Device / path                              | Actual mapping / state                                                      | Evidence                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/dev/nvme0n1`                             | 238.5G NVMe, TEAM TM8FP6256G; SSD                                           | `11-devices.json`, exit0                                                               |
| `/dev/nvme0n1p1`                           | 512M vfat mounted `/boot/firmware`                                          | `11-devices.json`, `13-mounts.json`, exit0                                             |
| `/dev/nvme0n1p2`                           | 238G ext4 mounted `/`                                                       | same; actual repository filesystem                                                     |
| `/home/juyoungoh/CupMemo`                  | `/` → `/dev/nvme0n1p2`, ext4, rw/noatime                                    | `findmnt --target /home/juyoungoh/CupMemo`, `12-repo-mount.json`, exit0                |
| Repository and `/var/lib/docker` capacity  | Same root:234G total,214G used,7.6G available,97% used                      | `df -h` for each; `14-repo-space.json`, `09b-docker-space.json`, exit0                 |
| `/dev/sda`                                 | 931.5G USB, TOSHIBA MQ04UBF100; observed external disk candidate            | `11-devices.json`, exit0; not an approved production device                            |
| `/dev/sda1`                                | 931.5G ext4; MOUNTPOINTS empty, no corresponding source in full mount table | `11-devices.json`, `findmnt --json -o TARGET,SOURCE,FSTYPE` in `13-mounts.json`, exit0 |
| `loop0`, `zram0`                           | 2G swap devices; zram marked `[SWAP]`                                       | `11-devices.json`; not application storage                                             |
| Actual production HDD mount/data directory | **UNVERIFIED**; absent approved mounted path                                | No guessed path, capacity or data contents                                             |

`df` filesystem sizes and `lsblk` device sizes are different measurements, not
contradictory claims of usable capacity. Unmounted ext4 does not establish
availability, health, ownership, safe contents or permission to mount. No fsck,
format, partition, mount/unmount, fstab/service change or directory creation on
proposed HDD storage occurred. Do not substitute an SSD directory or Docker named
volume for the required production HDD. Issue11 must reject startup if the approved
HDD is absent or a proposed data path resolves to SSD/root.

## OBSERVED: running containers

`docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`
completed exit0 (`10-containers.json`). All listed containers were Up2 days;
`healthy` below is Docker's reported state, not application verification. Preserve
ALL of them, including historical CupMemo fixtures not owned by this audit.
Host mappings are distinct from container-only exposed ports.

| Name                    | Image                                                          | Health / host-published ports                                                     |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| cupmemo-t-1befe331      | postgres:17.6                                                  | no health label; **127.0.0.1:55425→5432 TCP**; historical fixture, not production |
| homarr                  | ghcr.io/ajnart/homarr:0.16.1                                   | healthy; wildcard7575 TCP                                                         |
| aiometadata             | ghcr.io/cedya77/aiometadata:latest                             | healthy; wildcard3232 TCP                                                         |
| aiostreams              | ghcr.io/viren070/aiostreams:latest                             | healthy; wildcard3000 TCP                                                         |
| sure-worker             | ghcr.io/we-promise/sure:0.6.5-hotfix.1                         | no health label; container-only3000 TCP                                           |
| sure-redis              | redis:8.2.1-alpine3.22                                         | healthy; container-only6379 TCP                                                   |
| sure-web                | ghcr.io/we-promise/sure:0.6.5-hotfix.1                         | no health label; wildcard23000→3000 TCP                                           |
| sure-db                 | postgres:16                                                    | healthy; container-only5432 TCP                                                   |
| big-bear-syncthing      | syncthing/syncthing:2.0                                        | healthy; wildcard8384/22000 TCP,21027/22000 UDP                                   |
| aiometadata_redis       | redis:7-alpine                                                 | healthy; container-only6379 TCP                                                   |
| big-bear-portainer      | portainer/portainer-ce:latest                                  | no health label; wildcard8000/9000/9443 TCP                                       |
| big-bear-pihole         | pihole/pihole:latest                                           | healthy; wildcard53 TCP/UDP,67 UDP,8080→80/10443→443 TCP; container-only123 UDP   |
| immich-server           | ghcr.io/immich-app/immich-server:v2.7.5                        | healthy; wildcard2283 TCP                                                         |
| immich-machine-learning | ghcr.io/immich-app/immich-machine-learning:v2.7.5              | healthy; no published ports reported                                              |
| immich-redis            | redis:6.2.20-alpine                                            | no health label; container-only6379 TCP                                           |
| immich-postgres         | ghcr.io/immich-app/postgres:14-vectorchord0.3.0-pgvectors0.2.0 | healthy; container-only5432 TCP                                                   |
| big-bear-upsnap         | ghcr.io/seriousm4x/upsnap:5.3.4                                | healthy; no published ports reported                                              |
| yastream                | tamthai/yastream:latest                                        | healthy; wildcard55913 TCP                                                        |

Wildcard mappings above are both IPv4 and IPv6 where reported by Docker. A blank
mapping does not certify lack of network exposure (for example host networking was
not inspected). No container logs, environment, database contents or full inspect
were accessed; no stop/remove/pull/up/prune action occurred.

## OBSERVED: listeners and protected services

`ss -H -ltn` and `ss -H -lun` completed exit0. Full actual local bind addresses and
ports remain in `15-tcp.json` / `16-udp.json`, without process argv. These are
listener observations, not reachability/firewall tests or ownership attribution.
IPv4/IPv6 variants are grouped here, not erased from original evidence.

| Protocol / bind class                         | Observed ports                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TCP IPv4 wildcard `0.0.0.0`                   | 22,53,111,139,445,2283,3000,3232,7575,7878,8000,8080,8384,8642,8765,9000,9443,10443,22000,23000,55913 |
| TCP IPv6 wildcard `[::]`                      | 22,53,111,139,445,2283,3000,3232,7575,8000,8080,8384,9000,9443,10443,22000,23000,55913                |
| TCP wildcard `*` as reported                  | 80,8090                                                                                               |
| TCP IPv4 loopback `127.0.0.1`                 | 5572,8890,9239,35705,36891,38879,38925,44689,45197,45311,45763,45959,52827,55425                      |
| TCP local Tailscale IPv4 bind                 | 443,8443,8444,8445,9119,36339                                                                         |
| TCP local Tailscale IPv6 bind                 | 443,8443,8444,8445,32819                                                                              |
| UDP IPv4 wildcard                             | 53,67,111,137,138,5353,21027,22000,41641,54215                                                        |
| UDP wildcard `*` as reported                  | 53,67,111,5353,21027,22000,34889,41641                                                                |
| UDP local LAN/bridge addresses and broadcasts | 137,138; original log preserves each address                                                          |

Thus3000/8000, existing web/admin ports and55425 are occupied; a private container
port5432 or6379 does **not** imply a host listener. No diagnostic host port is
selected or reserved by this plan; no bind/listen server was opened.

`systemctl list-units --type=service --state=running --no-pager --plain` and its
`--user` equivalent completed exit0 (`17-system-services.json`,
`18-user-services.json`). All listed units were loaded/active/running. Full inventories
are retained, including desktop, storage, network and OS services.

| Protected group           | Observed unit names / boundary                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hermes                    | User `hermes-dashboard.service`, `hermes-gateway.service`, `hermes-gateway-cupmemo.service`                                                                                                                                                       |
| Trading / DashCraft       | User `hermes-gateway-trading.service`, `hermes-gateway-dashcraft.service`; preserve their capacity/claims                                                                                                                                         |
| Shared dispatcher         | No separately named dispatcher unit in these running-unit lists; hosting/process identity **UNVERIFIED** by unit inventory, not evidence it is absent; preserve owner-verified singleton runtime and scheduling                                   |
| Retained Trading evidence | User `stock-evidence-t_f7d9f047-private.service`, `stock-evidence-t_f7d9f047-private-guard.service`                                                                                                                                               |
| Other user applications   | `lab-dashboard.service`, `news-feed.service`, `rpi-connect.service`, `rpi-connect-wayvnc.service`; plus desktop/audio/portal services in full log                                                                                                 |
| Docker / administration   | System `docker.service`, `containerd.service`, `ssh.service`, `tailscaled.service`, `cron.service`                                                                                                                                                |
| CasaOS                    | System `casaos.service`, `casaos-app-management.service`, `casaos-gateway.service`, `casaos-local-storage.service`, `casaos-message-bus.service`, `casaos-user-service.service`                                                                   |
| Storage/network/OS        | System `rclone.service`, `devmon@devmon.service`, `udisks2.service`, `smartmontools.service`, `nfs-blkmap.service`, `rpcbind.service`, `smbd.service`, `nmbd.service`, `winbind.service`, `NetworkManager.service`; full inventory retains others |

No unit/config/auth/shared-dispatcher changes or unrelated workload cleanup are
permitted. Unit names do not prove which process owns every listener; attribution
and capacity guarantees remain unverified rather than guessed from port numbers.

## OBSERVED / UNVERIFIED: Tailscale

| Allowlisted `tailscale status --json` summary | Result at observation                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| BackendState                                  | Running                                                            |
| Self.Online                                   | true                                                               |
| Health                                        | present,0 messages; no reported messages                           |
| Peer counts                                   | 7 known,1 Online=true,0 Active=true                                |
| Command result                                | exit0; `19-tailscale.json`; raw JSON excluded                      |
| Developer-PC → Pi SSH round-trip              | **UNVERIFIED**; no peer probe/login authorized                     |
| Public HTTPS / Cloudflare / phone access      | **UNVERIFIED**; not inferred from local Tailscale or SSH listeners |

Online and Active are reported peer fields, not a proved connected developer
session. Local status confirms only the local daemon's report. No peer names,
logins, public endpoints, tokens, tunnels or auth state are published.

## PROPOSED: collision-avoiding future boundary

This is a conditional implementation plan for later owner-authorized Compose work,
not a replacement architecture, installed stack or production release decision.
`docker network ls --format '{{.Name}}\t{{.Driver}}\t{{.Scope}}'` completed exit0
(`20-network-names.json`). Existing names were `aiometadata_default`,
`aiostreams_default`, `big-bear-homarr_default`, `big-bear-immich_big_bear_immich_network`,
`big-bear-pihole_pihole-network`, `big-bear-syncthing_default`, `bridge`,
`homarr_default`, `homarr_homarr-network`, `host`, `none`, `sure_sure_net`,
`yastream_default`. Proposed names below were not in that observation; they are
**unreserved**, requiring fresh name/listener/route checks at activation.

| Future boundary  | Conditional choice / rationale                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose project  | `cupmemo-prod`; no reuse of another project's resources                                                                                                                                        |
| Services         | Canonical `cupmemo-web`, `cupmemo-api`, `cupmemo-postgres`, `cloudflared`, scoped by project; no global `container_name` overrides                                                             |
| App network      | Project-local `app`, effective `cupmemo-prod_app`; web/API and approved routing/tunnel connect here, not existing application networks                                                         |
| Database network | Separate project-local `database`, effective `cupmemo-prod_database`, internal; API/PostgreSQL only, no web/tunnel access                                                                      |
| External entry   | Future approved Cloudflare tunnel on app network; same public origin `/` → web and `/api/v1/*` → API, using separately reviewed routing configuration                                          |
| Host publishing  | **None by default** for web/API/PostgreSQL; no new collision with observed host ports and no default5432/3000/8000 reuse                                                                       |
| Diagnostics      | No chosen host port; if later required, check actual TCP/UDP/address binds immediately, select an owner-approved loopback-only port, mark conditional/unreserved and recheck before activation |
| Subnets          | No hardcoded CIDR selected; fresh Docker/LAN/Tailscale route-overlap discovery required before network creation; existing networks are not modified                                            |
| Storage          | Production HDD path remains unset until owner approves device/mount/data directory and Issue11 fails safely with HDD absent                                                                    |

A tunnel container needs outbound connectivity; do not declare the entire app
network `internal` in a way that prevents that. Only the database network is
proposed internal. No API/DB host port is needed merely for same-origin routing.
Existing occupied ports are left untouched. New networks/storage/routing/containers
require their own authorized implementation gates; this audit proves neither
runtime network isolation nor subnet collision-freedom after creation.

## Unresolved prerequisites and minimum owner action

1. **HUMAN-GATED / UNVERIFIED:** approve the production target and identify the
   intended HDD by stable identity/ownership, approve an actual mounted path and
   production data directory outside Git. Current `/dev/sda1` observation alone is
   not that approval. Any mount/repair/config action needs separate explicit scope.
2. **UNVERIFIED:** actual HDD path acceptance in Issue31. Keep this original criterion
   unfinished even if the partial audit PR merges. Owner may park THIS SAME card
   `needs_input`; no replacement or retry card is needed.
3. **HUMAN-GATED:** complete Issue11 mount/startup guard before production; prove
   absent HDD cannot create/use SSD-root live data without unauthorized unmounts.
4. **HUMAN-GATED:** decide acceptable SSD/RAM/swap capacity and workload coexistence
   plan without global cleanup, competitor stop or evidence deletion.
5. **UNVERIFIED:** dispatcher process hosting, developer-PC SSH round-trip, fresh
   activation network/route/port checks and production isolation. Use approved
   nonsecret checks; do not dump unrelated argv/environment or peer endpoints.
6. **HUMAN-GATED / UNVERIFIED:** production-specific disposition/remediation of all12
   advisories and separate R1/auth-redirect reliability risks; authorized Compose32,
   routing41/startup42, Cloudflare/domain/secrets/public HTTPS43–46. This audit does
   not implement or clear any of them.
7. **UNVERIFIED:** real backups/retention/restore/disaster recovery47–49, physical
   Android/iOS use/native phone installation, assistive screen readers, production
   cookie/proxy/log privacy. Existing gates and retention targets remain unchanged.

Documentation acceptance is distinct from deployment acceptance. Fresh scoped
Markdown formatting, diff/hygiene/unchanged-product proof and exact-final-head PR
quality CI are recorded externally. No fabricated test-first RED, local full E2E,
integration, build or visual execution is claimed. Same-card route is original
coder → independent `cupmemo-code-reviewer` → `cupmemo`; docs-only requires no
visual review. Technical zero-Blocking PASS may accept the document/evidence while
retaining the unresolved HDD criterion. Only the owner integrates or decides
Issue/card completion; neither specialist merges, closes nor self-approves.
