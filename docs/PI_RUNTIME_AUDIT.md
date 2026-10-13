# Read-only Pi runtime audit (Refs #31)

## Current-status navigation

**Historical pre-mount snapshot below:** every original observation and decision
after this banner is retained unchanged from the integrated F1 baseline. Its
unmounted-HDD statements describe **2026-10-13T02:15:50-05:00**, not current state.
See the [current supplement](#current-supplement) for fresh read-only observations
at **2026-10-13T07:42:42-05:00**: the HDD is mounted at `/DATA/nas`, while
`/mnt/nas-hdd` resolves to SSD/root. Neither path discovery nor persistent mount
configuration approves a production data directory, deployment or Issue11 guard.
Owner acceptance of the full original Issue31 remains pending.

## Historical pre-mount snapshot

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

## Current supplement

### Identity, evidence and observation limits

Fresh observation starts **2026-10-13T07:42:42-05:00**; individual commands have
their own start/end timestamps and exit statuses. Original coder
`code-monkey-cupmemo`, original implementation run2785, current revision2814,
SAME HQ card `t_95163d0d`, [Issue31](https://github.com/ohjy1006kenneth/CupMemo/issues/31).
The [owner supplement contract](https://github.com/ohjy1006kenneth/CupMemo/issues/31#issuecomment-6144511537)
authorizes only this read-only current-state documentation. Approved baseline is
merged F1 `d0efc680840fadae2b7dfe984162ca97e39e984e`, tree
`0e84650b99328de1752d85875df3e0dcfb357648`; its
[main CI38389912784](https://github.com/ohjy1006kenneth/CupMemo/actions/runs/38389912784)
completed SUCCESS. F1 is integrated, not a current formatting failure or production
acceptance. Historical skipped-format controls and failures remain retained.

Evidence locator: native `cupmemo31-current-2814.zip` and its external manifest
on this SAME card. It contains full sanitized `IMPLEMENTATION.md`, task-private
`probes.py`, original numbered JSON logs, check scripts/reports and publication
receipts. Each probe records exact argv, timestamps, status and bounded output.
References below are archive-relative filenames. Exact final commit/tree and CI
belong in the external receipt, not a self-invalidating document hash. Prior native
317–321 retain revision2807; 322–326 retain independent review2808, owner2809 and
the superseding contract. They are historical receipts, not fresh worker execution.

All current numbered probes completed exit0. Tailscale raw JSON was parsed only in
memory into an allowlist; no peer identities, logins or endpoints were retained.
No NAS contents, recursive scans, write probes, process argv/environment, full
Docker inspect/logs, installation, local build/test/browser fixtures or host
configuration changes were used. Capacity differences from older snapshots do not
establish a cleanup, data-movement or deletion cause.

### OBSERVED: current runtime and coexistence

- `01-date.json`, `02-arch.json`, `03-cpu.json`, `06-model.json` and
  `29-os-release.json`: Raspberry Pi5 Model B Rev1.1, aarch64, Debian GNU/Linux13
  (trixie), full version13.4; four online Cortex-A76 CPUs, maximum2400MHz.
- `04-memory.json`: RAM7.9Gi total,5.4Gi used,2.5Gi available; swap2.0Gi total/used,
  only176Ki free. `05-load.json`: uptime3 days28 minutes, load0.26/0.45/0.54.
  Instant load is not a sustained-capacity benchmark; nearly exhausted swap still
  threatens coexistence even though SSD free space is higher than historically.
- `07-docker-version.json`, `08-compose.json`, `09-docker-root.json`: Docker
  server29.4.2, Compose v5.1.3, root `/var/lib/docker`.
- `30-node.json`, `31-pnpm.json`: Node24.15.0, pnpm10.34.6. Existing project-local
  Prettier3.9.9 checks only the two authorized Markdown files with this checkout's
  configuration and explicit empty ignore path. No dependency installation.

**HUMAN-GATED:** choose capacity/resource limits and coexistence strategy before
production. Do not reclaim space by deleting other outcomes' evidence, pruning
Docker, stopping workloads or inferring spare sustained capacity from these reads.

### OBSERVED: actual current SSD/HDD paths

- `11-devices.json`, `12-repo-mount.json`, `24-docker-target.json`: repository
  `/home/juyoungoh/CupMemo` and Docker root `/var/lib/docker` resolve to `/` on
  `/dev/nvme0n1p2`, ext4 SSD/root, UUID
  `493d6733-2a8b-482b-b39f-a7ecc1ce8863`, label `rootfs`, options `rw,noatime`.
  Physical NVMe is238.5G TEAM TM8FP6256G; root partition238G. Firmware partition
  `/dev/nvme0n1p1` is512M vfat, UUID `5AC1-0D52`, mounted `/boot/firmware`.
- `11-devices.json`, `21-hdd-source.json`, `22-hdd-target.json`:931.5G TOSHIBA
  MQ04UBF100 USB disk `/dev/sda`, ext4 `/dev/sda1`, label `NAS_DATA`, UUID
  `68391fd3-3c92-4cfe-82db-47a5e6abb2ee`, **currently mounted `/DATA/nas`**,
  options `rw,nosuid,nodev,relatime`. Both source-UUID and target queries agree.
- `23-old-target.json`: **`/mnt/nas-hdd` is NOT the current HDD mount**. It resolves
  to `/` on the SSD UUID above. A directory name or earlier mount receipt cannot
  establish current storage identity. Treat using it for HDD live data as an
  SSD-fallback hazard; do not restore the earlier mount path automatically.
- `14-space.json`: root234G total,134G used,88G available,61% used for repository,
  Docker root and `/mnt/nas-hdd`; HDD916G total,86G used,784G available,10% used
  at `/DATA/nas`. Device and filesystem sizes are different measurements.
- `28-root-permissions.json`: mount root `/DATA/nas` is `root:root`, mode777;
  `/mnt/nas-hdd` is `root:root`, mode755. World-writable mount-root permissions
  are a risk, **not approved PostgreSQL PGDATA ownership/permissions**. No
  production directory is selected or created; do not use the mount root as
  PGDATA or automatically chown/chmod it.

Actual mounted HDD path discovery is now retrievable, unlike the historical
pre-mount snapshot. Permission intent, private contents, disk health, data movement
and the cause of path/capacity changes remain **UNVERIFIED** and were not inspected.
The fresh mapping corroborates owner2809/reviewer2808 current `/DATA/nas` receipts;
earlier `/mnt/nas-hdd` mounting receipts remain evidence of earlier dated state only.

### OBSERVED configuration / UNVERIFIED reboot continuity

`25-fstab.json`: line5 maps HDD UUID `68391fd3-3c92-4cfe-82db-47a5e6abb2ee` to
`/DATA/nas` as ext4 with
`defaults,nosuid,nodev,nofail,x-systemd.device-timeout=10s`, dump0/pass2.
`26-mount-unit.json`: `DATA-nas.mount` is active/mounted, What `/dev/sda1`, Where
`/DATA/nas`, options `rw,nosuid,nodev,relatime`, generated fragment
`/run/systemd/generator/DATA-nas.mount`. `27-boot-dependencies.json` includes
`DATA-nas.mount` under `local-fs.target`.

This is **persistent configuration evidence**, not proof of an actual successful
reboot, future USB availability or application safety. `nofail` permits boot to
continue without this mount; it does not implement the fail-closed Issue11 guard.
No reboot, unmount, fstab/unit edit or storage write was performed. Production
startup must independently verify expected mounted filesystem identity and the
approved data directory's actual mapping before PostgreSQL may start.

### OBSERVED: refreshed protected workloads and network inventory

`10-containers.json` retains every current name, image, reported state and published
port. The same18 names/images in the historical container table are present and
Up; most report Up3 days, while `big-bear-syncthing` and `immich-server` report
Up4 hours. Those are Docker status observations, not application health tests or
an explanation of restart causes. Published mappings remain as in the historical
table, including retained `cupmemo-t-1befe331` on loopback55425; container-only
5432/6379 are not host-published ports. Preserve ALL containers, including fixtures
not owned by this audit; no Docker lifecycle action was taken.

`17-system-services.json` and `18-user-services.json` retain full current running
unit inventories:36 system and27 user units, loaded/active/running. In particular:

- Hermes: `hermes-dashboard.service`, `hermes-gateway.service`,
  `hermes-gateway-cupmemo.service`; Trading/DashCraft:
  `hermes-gateway-trading.service`, `hermes-gateway-dashcraft.service`.
- Other user workloads: `lab-dashboard.service`, `news-feed.service`,
  `rpi-connect.service`, `rpi-connect-wayvnc.service` and desktop/audio/portal units.
  Historical `stock-evidence-*` units are not in this current running-unit list;
  this observation neither establishes their disposition nor authorizes changes.
- System: Docker/containerd, SSH/Tailscale/cron, all listed CasaOS units,
  rclone/devmon/udisks2/smartmontools, Samba/NFS/rpcbind, NetworkManager and other
  OS services. Preserve every listed workload, not just the named examples.
- Shared dispatcher process hosting remains **UNVERIFIED** by running-unit names;
  absence of a separately named unit does not imply absence of the owner-verified
  singleton. Preserve its scheduling, global capacity and all other active claims.

`15-tcp.json` / `16-udp.json` retain actual local addresses/ports without process
argv. Current TCP IPv4 wildcard ports are
22,53,111,139,445,2283,3000,3232,7575,7878,8000,8080,8384,8642,8765,9000,9443,10443,22000,23000,55913;
IPv6 wildcard ports are
22,53,111,139,445,2283,3000,3232,7575,8000,8080,8384,9000,9443,10443,22000,23000,55913;
wildcard `*` TCP ports are80/8090. IPv4 loopback ports are
5572,9239,35705,36891,38879,38925,44689,45197,45311,45763,45959,52827,55425.
Local Tailscale-bound TCP ports are443/8443/8444/9119/36339 on IPv4 and
443/8443/8444/32819 on IPv6. Historical8890/8445 are not in this fresh inventory;
no availability reservation or ownership inference follows.
UDP IPv4 wildcard ports are53,67,111,137,138,5353,21027,22000,41641,54215;
wildcard `*` UDP ports are53,67,111,5353,21027,22000,34889,41641;
local LAN/bridge/broadcast UDP binds include137/138. Listener inventory does not
prove firewall/public reachability or service ownership.

`20-network-names.json` retains the same13 network names as the historical network
inventory; neither `cupmemo-prod_app` nor `cupmemo-prod_database` appears.
**PROPOSED / unreserved:** retain future project `cupmemo-prod`, canonical four
services, separate app and internal database networks, no global `container_name`,
no other-project network reuse and no hardcoded subnet. Publish **no host ports by
default**; no diagnostic port is required, chosen, reserved or opened. Tunnel
outbound connectivity and fresh network/route/address/port overlap checks are
required at future authorized activation. This naming plan is not implemented
network isolation or a post-creation collision guarantee.

`19-tailscale.json`: BackendState Running, Self.Online true, health present with0
messages;7 known peers,1 Online=true,0 Active=true. This local daemon summary is
**not developer-PC SSH or public HTTPS proof**. Those round-trips, Cloudflare and
phone access remain **UNVERIFIED**; no peer probe/login or tunnel action occurred.

### Original Issue31 audit criteria and remaining gates

1. **Documented environment audit:** fresh runtime/resource/storage/container/
   listener/unit/network/Tailscale evidence above, separately dated from historical
   evidence. Exact-head documentation review/integration remains owner-gated.
2. **Noncolliding choices:** proposed project/network names absent from current
   names, no host publishing by default and no diagnostic reservation. Fresh
   activation overlap/outbound checks and runtime isolation remain **UNVERIFIED**.
3. **Actual SSD/HDD paths known:** fresh UUID/source/target/df evidence now identifies
   SSD repository/Docker root and HDD `/DATA/nas`, with explicit `/mnt/nas-hdd`
   SSD hazard. This supplies actual-path audit evidence, **not approval of a
   production target, directory or PGDATA permissions**. Owner alone decides
   whether the original audit criterion is fully accepted after exact-head review.
4. **Protection plan:** preserve all observed workloads/units, private conditional
   boundaries, capacity/permission risk and fail-closed storage requirements;
   do not mutate competitors or assume unused sustained capacity.

**HUMAN-GATED / UNVERIFIED production prerequisites remain prominent:**
`deployment_target=null`; production-specific HDD directory/ownership/permissions,
Issue11 absent-HDD/SSD-fallback guard, sustained capacity and network isolation,
reboot continuity, public target/domain/tunnel/HTTPS, developer-PC SSH, backups and
actual restore/disaster recovery, physical-phone/accessibility checks and production
cookie/proxy/log privacy. All12 advisories, R1 and separate auth-redirect debt
remain development/preparation-only, not public-production cleared. Minimum owner
action is current-path audit acceptance plus separate production target/storage/
permission/guard decisions, **not an invented missing-mount request**.

Only the owner may accept/integrate and decide full original Issue/card completion.
Same-card technical review follows on the exact new candidate; docs-only requires
no visual review. Neither this supplement nor a zero-Blocking technical verdict
automatically completes Issue31/11 or authorizes any production/storage mutation.
