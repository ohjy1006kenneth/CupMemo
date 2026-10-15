# NAS isolation preparation (Refs #11)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/11. SAME primary HQ card
`t_9cbb487a`, tenant `cupmemo`. Original implementer `code-monkey-cupmemo`,
implementation run2817; this preparation continues that unfinished outcome.
The [current approval](https://github.com/ohjy1006kenneth/CupMemo/issues/11#issuecomment-6157130412),
[four-file preparation contract](https://github.com/ohjy1006kenneth/CupMemo/issues/11#issuecomment-6157243778)
and [baseline amendment](https://github.com/ohjy1006kenneth/CupMemo/issues/11#issuecomment-6159413165)
govern. Prior dated audit observations remain historical, not current permission.

## Approved versus held

Kenneth approved use of the existing HDD with ONLY root0777 ->0755 restrictions,
unchanged root ownership and existing child permissions/content, plus narrow
Samba/Syncthing/known-backup isolation of reserved `cupmemo`. Ordinary NAS users
lose top-level create/delete/rename; legitimate existing child access is to remain.
Do not repeat the resolved storage-plan approval question.

This tool performs **preparation only**. Coder/reviewer must not apply live changes.
Owner alone may activate independently reviewed exact live candidates after fresh
preconditions and rollback review. No PGDATA directory, production UID assignment,
database initialization/startup, public deployment, mount/unmount/reboot/fstab
change, image pull, unrelated-service change or personal-file mutation is authorized.
The proposed `/DATA/nas/cupmemo/postgres` is reserved planning, not provisioned storage.

## Provenance and current independent gates

Owner2835's dated observation (2026-10-13) identified:

- HDD `/DATA/nas`, ext4 UUID `68391fd3-3c92-4cfe-82db-47a5e6abb2ee`, device8:1,
  fsroot `/`; `/DATA` on SSD/root UUID `493d6733-2a8b-482b-b39f-a7ecc1ce8863`.
- Root0:0/0777; Photos1000:1000/0775, Projects1000:982/0775,
  University1000:1000/0755, base ACLs only. The original PostgreSQL guard still
  correctly refuses world-writable ancestry. Planner eligibility does not waive it.
- Samba's actual `[nas]` declaration is `/etc/samba/smb.casa.conf`, included by
  `/etc/samba/smb.conf`, not a share to redesign in the root file. Existing path,
  forced user, guest/writable policy and all other settings must remain.
- Exact Syncthing project `local-syncthing`, service `big-bear-syncthing`, managed
  declaration `/var/lib/casaos/apps/local-syncthing/docker-compose.yml`.
  University-only unpaused sendreceive folder; whole HDD bind currently exposes
  more than that configured sync scope. It is incorrect to claim whole-root sync.
- Declaration root0:0/0600 was unreadable using supported current access. `sudo -n`
  denied; bounded supported polkit recovery timed out. No root-helper container,
  socket abuse, credential copying, password persistence or security relaxation.
- Loopback rclone read-only `job/list` was HTTP200/schema-valid with one job.
  Current/future dynamic-job exclusions remain **UNVERIFIED**, not an empty-list
  inference or a reason to disable all backup jobs.

Actual fresh CLI receipts, source/candidate hashes and original failures are retained
on the primary card. Successful Samba preparation/testparm is not deployed client
exclusion evidence. Syncthing may safely refuse until readable managed source and
exact runtime/folder verification are available; no synthetic live source/hash is
substituted. Unreadable-source refusal does not block safe Samba preparation.

## Executable interface

Use Node24 and existing stdlib/host tools. No `.env` sourcing, env test bypass,
automatic apply, arbitrary child launch, permission change or service management:

```sh
node infrastructure/scripts/nas-isolation-plan.mjs --check --component samba
node infrastructure/scripts/nas-isolation-plan.mjs --check --component syncthing
node infrastructure/scripts/nas-isolation-plan.mjs --prepare /absolute/task-private/ssd-directory --component samba
node infrastructure/scripts/nas-isolation-plan.mjs --prepare /absolute/task-private/ssd-directory --component syncthing
```

The operator must supply an **existing empty** owner0700 directory on verified
SSD/root, outside every repository checkout and production/system paths. No mkdir
or overwrite occurs. Root, home itself, HDD, nested mounts, symlink components,
wrong owner/mode, nonempty directories and nonnormalized paths are refused. Path
characters are limited to ASCII letters/digits, `_`, `.`, `/`, `-` to avoid private
config include ambiguity. `/tmp` on this host is tmpfs, not SSD, and is refused.

`--check` writes nothing. Exit0 means ONLY the selected component's preparatory
eligibility, not applied isolation. `--prepare` writes exclusive0600 candidate
(`samba.candidate.conf` or `syncthing.candidate.yml`) and `receipt.json`; full
candidate is private, never a GitHub/native attachment. Samba temporarily creates
one exclusive0600 private validation-root copy, redirects ONLY its existing include
to candidate, invokes actual testparm and removes the exact own temporary inode.
Host Samba files are never changed. Testparm does not support `/dev/stdin` on the
exercised host; retained failed diagnostic is not a successful validation.

Receipt/stdout contain component, eligibility, hashes, prepared/applied states and
held privacy gates, never raw config/env/exception/probe output. Test injection is
exported-function parameters only; receipts explicitly label injected unit fixtures.
Failure publishes no success; cleanup removes only freshly created still-owned
inodes. If replacement/cleanup prevents safe removal, fixed diagnostics explicitly
retain private partial outputs. Inspect those privately, never blanket-delete.

### Verification details and supported transforms

Fresh lstat/realpath ancestry and before/after metadata snapshots refuse missing,
symlink, nondirectory, owner/mode/ACL/device drift. Root0777 is labeled awaiting
owner activation; observed0755 is labeled observed, not reapplied. `/`, `/DATA`
must remain root-owned non-group/world-writable SSD ancestry. Relevant child
metadata is allowlisted; no personal contents or recursive enumeration. Actual
findmnt verifies exact UUID/ext4/fsroot/target/device and rejects nested binds.
Commands use fixed executable/argv with no shell,2000ms/SIGKILL and64KiB stdout
and stderr limits. File reads are bounded, no-follow, regular-file/identity checked.
This is still **TOCTOU/stable-host dependent**, not an fd-relative hostile-parent
sandbox, hot-unmount lock, permanent NAS policy or PostgreSQL restart guard.

Samba pins the owner-observed root/include SHA256 baselines, so unexpected drift
or an already-applied veto is refused rather than overwritten. Pure transform
preserves every original byte except one inserted `veto files = /cupmemo/` under
exactly one `[nas]`. Duplicate sections/directives, existing veto, include/copy or
continuation ambiguity are refused. Existing credentials/settings/delete-veto
policy are untouched. **Name-pattern veto also denies `cupmemo` at other share
depths**, not only top-level. CasaOS regeneration can remove it: post-reload and
post-regeneration readback/durability verification are mandatory.

Syncthing supports only conservative unambiguous short absolute bind syntax, with
optional quotes and `:rw`. Long form is explicitly unsupported, as are anchors,
interpolation, duplicate mappings, unknown/ambiguous structure and wrong endpoints.
Change BOTH source AND destination `/DATA/nas` to `/DATA/nas/University`; retaining
the old destination would relocate University relative to its configured folder.
No general YAML reserialization. Docker Compose `config --format json` parses both
private source/candidate in memory, with empty env file and no env-file/path
resolution, no pull/start/config output file. Exactly one expected service, pinned
existing image/runtime/provenance, two RW binds, unchanged appdata and every other
effective setting are required. Runtime inspect is allowlisted in memory. The
existing appdata `config/config.xml` must be readable owner1000/0600, have one
University sendreceive/unpaused/ignorePerms=false folder using recognized XML
attributes. Unsupported XML/entities/shape refuse rather than guess. Fresh scope
fingerprint and source hashes must match before finalization. Unknown private
source shape or access is a precise refusal, not permission to fabricate a copy.

## Owner-only staged rollout and rollback

The following is a **review contract, not an executable approval to apply now**.
Before activation, owner records exact private baseline/candidate bytes and hashes,
finite root/child inode/owner/mode/ACL snapshots, Samba root/include hashes, and
Syncthing image/container/declaration/folder identity. Reviewer must inspect exact
live candidate settings/diff and bounded live-operation guard/rollback, not merely
fixture transforms. Acquire supported existing privilege without retaining secrets.

1. Freshly reverify HDD target/UUID/ext4/fsroot/device8:1, safe ancestry and unchanged
   root/children/ACL/config baselines before **each** affected operation. Missing
   HDD or unknown drift is STOP, never mkdir/fallback/recursive repair. Planner
   receipts are not reusable authorization for a later chmod or config overwrite.
2. Amend only the included nas veto after actual private testparm validation.
   Preserve the root file, other shares/users/credentials/settings. Reload only
   Samba configuration via supported `smbcontrol smbd reload-config`, not a host or
   daemon restart. Require testparm/readback after reload and CasaOS durability
   assessment. A missing reserved directory is not proof of veto: use independently
   reviewed isolated SSD share pattern controls plus real deployed-client checks.
   Do not create cupmemo/PGDATA on HDD to manufacture positive-denial evidence.
3. Change ONLY freshly verified HDD root0:0/0777 ->0755 in a separately reviewed
   guarded owner operation. Do not copy an unguarded chmod command from this doc.
   Recheck unchanged child metadata/ACLs/content boundaries. Root mode0755 must
   prevent ordinary NAS-user top-level create/delete/rename. Use only reviewed
   unique task-owned root refusal controls; unexpected write success is STOP.
   Existing child legitimate writes require explicit disposable University sentinel
   and sync containment review before any trial; otherwise leave workflows untested.
4. Read the managed private Compose declaration, prepare/inspect exact live candidate,
   preserve appdata/config/identity/ports/network/image and University contents.
   Recreate ONLY the existing service/project, existing image, with reviewed command:

   ```sh
   docker compose --project-name local-syncthing --project-directory /var/lib/casaos/apps/local-syncthing -f /var/lib/casaos/apps/local-syncthing/docker-compose.yml up -d --no-deps --pull never big-bear-syncthing
   ```

   Execute only after exact live-source/runtime review and owner gate. No broad
   up/down/prune, new image/network, other-container restart or missing-path creation.
   Confirm pinned image, narrowed source AND destination, process/health/folder
   identity and University workflow preservation; metadata/config syntax alone
   cannot certify no disruption. Retain precise missing client/runtime checks.

5. Inventory known broad sync/backup jobs through bounded allowlisted read-only
   runtime/config facts, not raw argv/remote URLs/keys or private contents. Verify
   tool-specific filter semantics for each source root. Require durable exclusion
   `/cupmemo/**` relative to NAS root for every known broad job, including future
   rclone dynamic-job policy. Job inventory is not policy coverage. Unknown coverage
   remains a privacy **STOP before any PGDATA**, while other safe approved phases
   may finish. Never change unknown remote sources/destinations or disable services.

Rollback only phases actually applied, after current state equals the recorded
applied candidate. Restore exact changed Samba include and reload only configuration;
restore original Syncthing declaration/bind and recreate only that exact service
with no-deps/pull-never; restore ONLY root mode0755 ->0777 with unchanged owner and
fresh mount verification. Root0777 restores the original PostgreSQL guard refusal.
Never overwrite drift, delete data, recreate missing University, recurse chmod/chown,
remount/reboot or touch another workload. Retain private originals and sanitized
forward/rollback receipts. CasaOS policy durability and privileged-root backup
coverage are independent unresolved gates, not solved by permissions/veto alone.

## Checks and original acceptance

```sh
corepack pnpm exec vitest run tests/nas-isolation-plan.test.mjs
corepack pnpm exec vitest run tests/postgres-hdd-guard.test.mjs tests/nas-isolation-plan.test.mjs
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm exec prettier --ignore-path /dev/null --file-info docs/DEPLOYMENT.md
corepack pnpm exec prettier --ignore-path /dev/null --file-info docs/NAS_ISOLATION.md
corepack pnpm exec prettier --ignore-path /dev/null --check docs/DEPLOYMENT.md docs/NAS_ISOLATION.md infrastructure/scripts/nas-isolation-plan.mjs tests/nas-isolation-plan.test.mjs
git diff --check
```

Run root gates sequentially with NODE_ENV unset and actual project-local dependencies.
Tests use real disposable SSD paths/files/symlinks/modes/exclusive-output sentinels
with injected HDD/ACL/Compose/runtime responses clearly labeled **UNIT FIXTURES**.
They are not mounted-test-HDD, real positive Syncthing candidate, native deployed
client checks or full backup acceptance. Retain behavioral RED/GREEN and all failures
separately, actual Samba check/prepare/testparm, safe Syncthing refusal, exact head/tree
and CI. No unchanged DB/browser/visual replay; no deadline/assertion/CI weakening.

Native same-card sanitized report/log ZIP includes whole/member bytes/SHA256/CRC32,
ZIP integrity and stored readback, excluding all full live configs, XML/private IDs,
credentials and candidate files. Exact commit/tree and private candidate hashes
belong in external receipts, not self-invalidating enclosing hashes. Original2817,
first resumed2872 and revision2900 remain distinct. Same-card independent focused
technical review returns to owner; specialists never merge, close or complete.

Original Issue11 remains OPEN: HDD identity and executable preparation do not prove
approved PGDATA/UID or deployed PostgreSQL missing-HDD/startup/reboot/restart safety.
[Original host-guard restart/race limits](DEPLOYMENT.md#remaining-original-acceptance-and-startuprestart-boundary),
future Issues32/42 privacy/create_host_path/restart wiring and existing development-only
advisory/R1/auth-redirect risks remain intact. No generic all-isolated PASS.
