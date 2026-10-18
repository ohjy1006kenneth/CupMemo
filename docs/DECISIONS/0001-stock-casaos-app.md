# Stock CasaOS owns the CupMemo app

## Status

Accepted user direction for source preparation (Issue11, primary `hq/t_9cbb487a`).
Implementation, independent review and owner integration remain distinct from live
installation/startup acceptance. Kenneth explicitly authorizes bounded private
HDD-only PGDATA provisioning and stock app/DB first startup, subject to reviewed
storage safety and owner activation/rollback. Public deployment remains held.

## Context

Replacing CasaOS/AppManagement to enforce reserved-folder share exclusion added
custom manager builds and broad privileged lifecycle complexity. Neither custom
manager was installed: owner reconciliation found stock binary hashes unchanged,
services active and custom control paths absent. Kenneth explicitly directed
reversion of all custom managers and a normal CasaOS app. He also accepts file
sharing in his private, sole-user Tailscale setup; share invisibility is not a
prerequisite. This does not waive HDD placement or database integrity.

## Decision

Keep stock CasaOS and stock AppManagement. Retire the custom source bundles,
dedicated manager workflow/tests and active manager deployment prerequisites in a
forward reviewed change, preserving history/evidence and approved NAS changes.
Prepare `infrastructure/casaos/docker-compose.yml` using the existing three-service
production model with ordinary `x-casaos` metadata. Preserve web/API images, explicit
external secrets, nonpublished database, ARM64/resource/security bounds and the
HDD bind with `create_host_path: false`. Keep `restart: 'no'`.

CasaOS is the single future app lifecycle owner. Retain the useful host mount guard
and regression-tested dormant startup alternative, but do not install that host
unit or run its wrapper concurrently with the CasaOS app. No fork, shim, custom
privileged hook or new deployment framework is introduced.

Use a minimal app-local official PG17 Debian derivative, adding a hardened
Linux C entrypoint and nonrecursively hardening only the IMAGE directory
`/var/lib/postgresql` to root:root0755 at build time. The official base's
postgres-owned1777 parent conflicts with strict ancestry admission; this narrow
metadata correction preserves all contents/packages/layout and does not permit
runtime/host chmod or an unsafe-ancestry exception. The entrypoint checks the actual fixed data-directory descriptor's ext4
UUID via `EXT4_IOC_GETFSUUID`, exact container-own mountinfo root/device, ownership,
permissions and nonsymlink paths before execing the fixed official entrypoint.
The stock app carries four explicit nonsecret guard inputs. No extra volume,
privilege, raw block device, host probe cache or new application dependency is
needed. Unsupported ioctl/kernel/seccomp evidence fails closed; no test bypass is
shipped. Initial owner provisioning/import still requires fresh host preflight.

## Alternatives considered

- Continue custom managers: rejected by explicit user direction; no deployment is
  present to undo on the host.
- Run both CasaOS and the host unit: rejected because duplicated ownership can
  bypass/reorder startup checks and contend over resources.
- Weaken credential values/bind/restart settings to satisfy an older importer:
  rejected. App-specific supported serialization is allowed; unsupported raw
  env-file syntax was a template detail, not a user requirement.

## Consequences

The active source is simpler and ordinary app services remain unchanged. Offline
Compose checks are executable but are not real CasaOS import or restart evidence.
The inspected stock parser cannot accept the modern reference's raw long-form
env-file. The stock app variant instead uses explicit API environment entries and
a small offline private-JSON preparation helper, with installed-version
import/marshal/reload tests preserving exact literal values. See
[PRIVATE_COMPOSE.md](../PRIVATE_COMPOSE.md) for sources, short preparation flow and
two-stage dollar escaping. No manager or application adapter is introduced; the
modern reference stays unchanged. The app-local gate runs on every process start;
live launch needs fresh HDD admission and remaining owner/runtime gates within
the already granted private authority. Missing-directory refusal alone does not prove rejection
of an existing SSD directory, hot-unmount safety or reboot behavior. No port or
dashboard launch URL is selected by this private candidate.

## Migration impact

This pass is source preparation only. No host binary replacement, service restart,
CasaOS DB chmod/copy/migration, data deletion or live NAS rollback is needed.
Specialists do not create production PGDATA or start DBs: those are authorized
owner actions after independent affected review. Public exposure is held. Historical evidence is
retained outside active product source. Reverting this forward source change must
not be treated as authority to install the abandoned custom managers.
