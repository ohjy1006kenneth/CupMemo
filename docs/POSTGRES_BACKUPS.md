# PostgreSQL backup engine (Refs #47)

## Status and authority

The executable runner, retention logic and dormant systemd templates exist in
source. They are **not installed, enabled or production-accepted**. Tests run real
fixture executables and temporary files on task-owned SSD storage: they verify
process/archive transport and refusal boundaries, not a real PostgreSQL dump,
archive readability, recovery or a running schedule. Issue #47/card stay open for
actual scheduled production-dump acceptance. Issue #48 restore remains unperformed.

The separate [guarded isolated-restore runner](POSTGRES_RESTORE.md) consumes the
unchanged backup-v1 bundle with external trusted archive/expectation hashes and a
matching historical release. Source/fixture checks are not actual restore proof.

PGDATA provisioning, database startup/connections, live NAS/HDD/private-backup
inspection, service installation/reload/enablement and public deployment remain
held. Nothing here grants activation authority or selects an endpoint, destination,
UID, credential or production tool. Preserve [NAS isolation](NAS_ISOLATION.md),
[storage/startup gates](PRIVATE_COMPOSE.md) and [recovery](DISASTER_RECOVERY.md).

## Executable interface and prerequisites

Use Node24 and the existing frozen-lockfile pnpm workspace. Build the existing
resolver offline before invoking the runner:

```sh
corepack pnpm --filter @cupmemo/database build
# Future authorized invocation, only after explicit private environment delivery:
node infrastructure/scripts/postgres-backup.mjs --run
```

Import is inert; any invocation other than exactly `--run` refuses. No `.env` is
loaded. Required inputs supplied through separately controlled private custody:

| Input                             | Contract                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DIR`                      | Existing private operator-owned absolute normalized directory, no trailing slash; outside all repository checkouts and PGDATA. Never a NAS share/sync/broad-backup source.                                                                                                                                                   |
| `CUPMEMO_PG_DUMP_BIN`             | Explicit absolute trusted **real** PostgreSQL17 `pg_dump` executable, not a symlink/wrapper/PATH lookup. Its ancestry and binary must be root/operator-owned and not group/world-writable. Typical distribution shim paths can be symlinks: select the verified versioned real executable, without installing anything here. |
| `CUPMEMO_DB_ENV`                  | Exactly development, test or production, using `resolveDatabaseConfig` from the built database package.                                                                                                                                                                                                                      |
| Matching `CUPMEMO_DATABASE_URL_*` | Only the selected mode's dedicated URL; no fallback. Explicit username/password, valid percent decoding, supported simple database identifier. Resolver separation/name/loopback/duplicate-target refusals remain in force.                                                                                                  |
| `CUPMEMO_TEST_DATABASE`           | Required in test mode, matching the selected loopback `cupmemo_test_<task>` database. Test name does not prove server ownership.                                                                                                                                                                                             |
| `POSTGRES_DATA_DIR`               | When configured, a normalized absolute exclusion path; nesting in **either** direction is refused. The operator must certify the destination is not any PGDATA, including otherwise unknown/remote paths, before activation. No PGDATA is discovered or read by the runner.                                                  |
| `CUPMEMO_BACKUP_TIMEOUT_MS`       | Optional positive integer, at most/default 1800000 (30 minutes).                                                                                                                                                                                                                                                             |
| `CUPMEMO_BACKUP_MAX_BYTES`        | Optional positive integer, at most/default 68719476736 (64 GiB), enforced while streaming stdout before writing excess bytes. Capacity must be verified separately.                                                                                                                                                          |

The destination must deny all group/other access. Each path component must be
root/operator-owned, not a symlink and not group/world-writable. The namespace,
bundles and files are owned by the operator, directories0700/files0600. No
permissions are repaired. Root and the operator must maintain exclusive custody
of paths, tools and checkout for the **whole** run; this is not protection from a
hostile same-UID/root process, concurrent administrator rename, remount or disk
failure. A lock protects cooperating runners, not arbitrary filesystem writers.

Presence of legacy `DATABASE_URL` or any `PG*` input is refused, even empty. No
`PGOPTIONS`, `PGSERVICE`, `PGPASSFILE`, `PGDATA` or inherited libpq redirect is
accepted. The runner constructs the child's allowlisted environment: host, port,
database, user, password, TLS mode, 10-second connection timeout, application name,
`PGPASSFILE=/dev/null` and C locale. No HOME/PATH/Node options/other service secrets
are inherited. Password is never argv, manifest or diagnostic text. libpq TLS
certificate trust uses its normal platform defaults; private certificate custody
and endpoint verification require operator review. URL `sslmode` accepts disable,
require, verify-ca or verify-full; omission deliberately selects require. Prefer
verify-full for nonlocal connections when compatible trusted certificates exist.
Opportunistic prefer/allow, arbitrary query parameters and URL fragments refuse.
No certificate path or other URL options are silently discarded.

The binary is checked with bounded `--version` output; only PG17 is accepted.
A distribution suffix is discarded, retaining only the canonical numeric version.
The dump uses literal argv, no shell: `--format=custom --compress=gzip:6
--no-password`. The complete selected database includes `public` auth, `cupmemo`
domain and `drizzle` migration data without schema/table filters. A per-database
dump does **not** include cluster roles or external secrets/configuration. Those
need separate private recovery custody. No extra outer gzip file is needed for
the internally gzip-compressed custom archive.

## Publication, metadata and failures

An exclusive `.cupmemo-backup.lock` under the destination refuses overlapping runs
before any pruning. It is not auto-expired, stolen or removed after an unknown
interruption. Under `cupmemo-backups-v1/`, a private `scope.json` pins the immutable
version1 target fingerprint. Each destination has one scope; changing target,
mode, user or TLS policy requires a separately approved new destination, never
editing its marker to mix histories. Password rotation alone does not split scope.
The SHA256 target fingerprint covers mode/host/port/database/user/TLS, not the URL
or password. It is pseudonymous metadata, not a password hash or anonymization
promise; retain it privately.

A fresh `.partial-backup-<UUID>/` contains an exclusively created `database.dump`.
Exit0, nonempty content, SHA256/size and a completed private `manifest.json` are
required before publication. Files/directories are fsynced; same-filesystem rename
publishes `backup-<UUID>/` atomically, with an explicit collision refusal. The
trusted exclusive-custody requirement applies to that check/rename boundary.
Nothing calls a partial a successful bundle. On failure only this invocation's
known partial files are unlinked; no recursive cleanup or foreign traversal is
used. Existing successes remain. Signals/timeouts stop the child with SIGTERM,
then SIGKILL after one second if needed, and await its close before cleanup.

Version1 manifest records ID, archive basename, byte count/SHA256, capture start
UTC time, normalized PG dump tool version and target fingerprint. Release metadata
records commit/tree and migration-file hashes from a clean trusted checkout, or
explicit `unverified` when unavailable/dirty. These are **checkout** identities,
not proof of deployed code or the database's actual migration state (explicitly
unverified). There is no SQL/row content, URL or credential in metadata. SHA256
proves bytes, not completeness, provenance or restore success. Wrong server
version/permissions, missing scopes or connectivity cause dump failure; the
fixture executable cannot establish real server acceptance.

Only fixed stage/result/count diagnostics are printed. Raw child stderr is
discarded, not logged/redacted after exposure. A failed phase is nonzero. After a
published copy, retention refusal is still job failure and visible as
`backup failed phase=retention`; the new copy is preserved, not rolled back. A
cleanup failure reports only `phase=cleanup`. Storage errors can leave owned
partial evidence; do not infer a clean state from a killed job. Future journal
monitoring must consider missing/late runs as well as nonzero exits. There is no
external notification service, alert delivery guarantee or backup dashboard.

## Retention semantics

Only after a new publication, scan the **entire** owned namespace. Every bundle
must have the expected UUID directory, exact two regular non-hardlinked private
files, valid version1 manifest for this scope, canonical UTC capture timestamp,
positive byte count and matching archive SHA256/size. Missing/corrupt metadata,
tampered bytes, links, unexpected entries/partial directories, mixed targets or
scan errors refuse **all pruning** and preserve evidence. Unrelated destination
files outside the namespace are ignored and never removed.

Keep the union of the newest successful bundle in each of:

- the latest 7 distinct UTC date buckets present;
- the latest 4 distinct ISO week-year/week buckets present (Monday-based);
- the latest 3 distinct UTC calendar month buckets present.

Always keep the newest success. Sort by manifest capture time descending, then ID
descending for exact ties; mtime has no role. Buckets are distinct **present**
buckets, not a rolling age cutoff. Sparse history survives; overlaps need only
one copy, not 14 guaranteed copies. After the complete validation pass, unlink
only the exact two files of eligible owned bundles and remove their now-empty
directories. No generic glob or recursive delete exists. An I/O failure midway
through deletion cannot restore already deleted eligible copies: stop, retain the
remaining state and escalate; the selected retained copies are never candidates.
Retention is not a recoverability guarantee, off-site copy or encryption scheme.

## Dormant future schedule and rollback

`infrastructure/systemd/cupmemo-backup.service.in` and `.timer.in` are uninstalled
source templates, not a running job. Future default: daily 03:15 UTC, randomized
up to 10 minutes, `Persistent=false` (no immediate catch-up on enable/boot). A
missed run is missed, not silently recovered. systemd oneshot overlap and the
runner's lock both prevent concurrent cooperating jobs. Service logs go to the
journal; umask0077, explicit operator identity, read-only system/home, one reviewed
writable destination, no automatic restart and control-group kill are specified.

Before separate authorized installation, render and independently review exact
`@CUPMEMO_OPERATOR_USER@`, `@CUPMEMO_RELEASE_DIR@`, `@CUPMEMO_NODE_BIN@`,
`@CUPMEMO_BACKUP_ENV_FILE@`, `@CUPMEMO_BACKUP_DIR@` substitutions. The external
private env file must agree with the writable path; review systemd escaping,
Node24/tool paths, ownership/certificate custody, endpoint authorization, available
space, sandbox access and the real PG17 backup on that exact host. Never load
application-wide secrets or arbitrary Node flags into the service environment.
No service install, daemon-reload, enable, start or restart is performed here.

For a separately installed future schedule, an authorized operator may stop and
disable **only** the verified owned `cupmemo-backup.timer`, then stop only the
owned service if a current job must be interrupted, waiting for its child to exit.
Record exact rendered unit/release identity and private receipts. Do not stop
PostgreSQL/Docker/Hermes, delete backups/locks or run broad cleanup as rollback.
Rollback to prior reviewed source requires reconciling any in-flight job and
preserving published copies; it does not undo retention deletions. No such unit
currently exists by virtue of these templates.

## Interrupted-run reconciliation

1. Stop only the separately authorized future timer; prevent new cooperating
   jobs. Record destination/scope/unit/release ownership and interruption time
   privately. A PID in a lock is a hint, not proof: PIDs can be reused.
2. Establish that the exact runner and dump child are no longer active using
   trusted process/service state under separate inspection authority. Unknown
   activity means STOP; never auto-remove a stale/foreign lock to force a retry.
3. Preserve the lock, partials, manifests and sanitized failure receipts. Inspect
   only the separately approved private destination; validate successful bundles
   independently. Unknown/malformed files must not be relabeled as successes.
4. Only after explicit operator reconciliation, quarantine the exact identified
   stale lock/owned partial outside the namespace under private custody. Never
   recursively delete links/unknown directories, edit checksums to make a scan
   pass or discard the only recoverable copy. A missing scope marker requires
   investigation, not automatic reconstruction or manual target mixing.
5. Recheck storage/privacy/capacity and request the exact authorized retry. A new
   scheduled/manual dump may prune only after successful publication and a fully
   valid scan. Restore testing is separate, using the actual selected copy under
   Issue #48 authority.

## Focused executable verification

```sh
corepack pnpm --filter @cupmemo/database build
corepack pnpm exec vitest run tests/postgres-backup.test.mjs --maxWorkers=1 --no-file-parallelism
corepack pnpm exec eslint infrastructure/scripts/postgres-backup.mjs tests/postgres-backup.test.mjs
corepack pnpm exec prettier --check --ignore-path /dev/null docs/POSTGRES_BACKUPS.md
```

Tests create only synthetic transport bytes with real child processes and private
task-owned temporary files, not PostgreSQL archives. No DB startup, private env
read or live backup is required. Operational acceptance still needs the actual
schedule, compressed complete PG17 dumps, private custody/failure visibility and
exact-head independent review/owner activation. Actual isolated restore, off-site
policy, RPO/RTO and alert ownership remain distinct unresolved work.
