# Stock CasaOS owns the CupMemo app

## Status

Accepted user direction for source preparation (Issue11, primary `hq/t_9cbb487a`).
Implementation, independent review and owner integration remain distinct from live
installation/startup acceptance. PGDATA, database startup and public deployment
remain held.

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
production model with ordinary `x-casaos` metadata. Preserve all images, explicit
external secrets, nonpublished database, ARM64/resource/security bounds and the
HDD bind with `create_host_path: false`. Keep `restart: 'no'`.

CasaOS is the single future app lifecycle owner. Retain the useful host mount guard
and regression-tested dormant startup alternative, but do not install that host
unit or run its wrapper concurrently with the CasaOS app. No fork, shim, custom
privileged hook or new deployment framework is introduced.

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
modern reference stays unchanged. Live launch stays disabled pending fresh HDD
admission and remaining authority/runtime gates. Missing-directory refusal does not prove rejection
of an existing SSD directory, hot-unmount safety or reboot behavior. No port or
dashboard launch URL is selected by this private candidate.

## Migration impact

This is source cleanup and packaging only. No binary replacement, service restart,
CasaOS DB chmod/copy/migration, data deletion, live NAS rollback, PGDATA creation,
DB startup or public exposure is needed or authorized. Historical evidence is
retained outside active product source. Reverting this forward source change must
not be treated as authority to install the abandoned custom managers.
