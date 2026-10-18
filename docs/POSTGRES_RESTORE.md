# Guarded isolated PostgreSQL restore (Refs #48)

## Status and authority

This is executable source/test preparation, **not recovery acceptance**. An actual
safe non-production restore, real source-oracle capture, representative private
values, authentication/session and application checks remain **UNPERFORMED**.
Issue #48 and its primary card remain open after partial source integration.
Fixtures use synthetic bytes, a compiled fake ELF executable and injected query
results. They are not PostgreSQL archives, a real catalog or restore proof.

No PGDATA provisioning, database startup/connections/restores/migrations, Docker
actions, private backup/env inspection, NAS/HDD changes, service installation or
public deployment is authorized by this guide. Future execution requires separate
exact-resource owner authorization and independent exact-head review. Preserve
[recovery](DISASTER_RECOVERY.md), [database](DATABASE.md),
[storage/privacy gates](PRIVATE_COMPOSE.md) and [backup custody](POSTGRES_BACKUPS.md).
There is no scheduler, automatic retry, database creation or target reset.

The separately authorized [disposable hosted synthetic drill](RECOVERY_DRILL.md)
exercises actual PG17 backup/restore and restored application behavior using only
throwaway generated data. Its exact-head artifacts and independent owner acceptance
are distinct from the source/fixture tests above; production holds are unchanged.

## Future explicit interface

Use Node24 and the frozen pnpm workspace. Offline build and source checks are
permitted; the restore invocation below is **conditional future operation only**:

```sh
corepack pnpm --filter @cupmemo/database build
# Only after separate authorization and explicit private environment delivery:
node infrastructure/scripts/postgres-restore.mjs --restore-test
```

Import is inert. All other argument combinations refuse. No `.env` is loaded,
endpoint chosen, password created or file discovered implicitly. Do not put URLs
or passwords in argv/history. Supply these inputs through private operator custody:

| Input                                 | Required contract                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUPMEMO_DB_ENV`                      | Exactly `test`; nonproduction `NODE_ENV`.                                                                                                    |
| `CUPMEMO_DATABASE_URL_TEST`           | Explicit resolver-approved loopback URL, username/password, decoded `cupmemo_test_<task>` database.                                          |
| `CUPMEMO_TEST_DATABASE`               | Exact decoded test name, per the existing database resolver.                                                                                 |
| `CUPMEMO_RESTORE_CONFIRM_DATABASE`    | Same exact decoded name; no wildcard/default.                                                                                                |
| `CUPMEMO_PG_RESTORE_BIN`              | Normalized absolute real trusted PG17 ELF executable, not PATH lookup, shell script, distro shim, symlink or hardlink.                       |
| `CUPMEMO_RESTORE_BUNDLE_DIR`          | Existing exact private backup-v1 `backup-<UUID>` directory containing only `manifest.json` and `database.dump`.                              |
| `CUPMEMO_RESTORE_EXPECTED_SHA256`     | Separately trusted lowercase64hex archive digest; not merely copied from an untrusted manifest.                                              |
| `CUPMEMO_RESTORE_RELEASE_DIR`         | Separately trusted clean existing checkout at manifest's verified exact commit/tree. No fetch, checkout or code execution from this release. |
| `CUPMEMO_RESTORE_EXPECTATIONS_FILE`   | Existing private independently trusted expectation JSON, at most256KiB.                                                                      |
| `CUPMEMO_RESTORE_EXPECTATIONS_SHA256` | Separately supplied lowercase64hex hash of the exact expectation bytes.                                                                      |
| `CUPMEMO_RESTORE_STATE_DIR`           | Existing private operator-owned state directory, outside bundle/repository/PGDATA. All cooperating invocations must use this same directory. |
| `POSTGRES_DATA_DIR`                   | If supplied, normalized absolute exclusion path only, never created or read. Operator must exclude **all** actual PGDATA independently.      |
| `CUPMEMO_RESTORE_TIMEOUT_MS`          | Optional positive integer, default/maximum1800000 (30min) for restore child; list is bounded at30sec and version at5sec.                     |

Any `PG*` environment key (even empty), nonempty legacy `DATABASE_URL`, configured
development/production URL, production mode, malformed credentials, fragment or
URL target/session override refuses. Only one `sslmode` is permitted: `disable`,
`require`, `verify-ca`, `verify-full`; omission means `require`. Passwords cannot
contain control characters. Existing resolver ambiguity/name/loopback guards are
retained. No shared resolver or accepted backup-v1 changes are made.

Paths cannot contain symlink components or writable/untrusted ancestry. Ancestors
and tools must be root/operator-owned, not group/world-writable; special mode bits
refuse. Private directories deny all group/other access; bundle is0700 and files
are operator-owned0600 regular non-hardlinked files. State, bundle and oracle are
outside this repository's primary/worktree roots and the selected historical
release. State and bundle cannot overlap; oracle cannot be stored inside either.
No chmod/chown/permission repair occurs. Binary ELF/version checks are guards, not
cryptographic authentication of a program. Operator must establish package/tool
provenance and exclusive custody of executable, release, inputs and paths.

## Trusted source and expectations

A SHA256 match proves bytes, not origin, completeness, benign SQL or authority.
Treat every archive as executable SQL capable of damaging even an isolated target.
Review source/operator custody, source identity, release compatibility, archive
contents and authorization **before** any future invocation. A `--list` exit0 is
bounded readability evidence, never semantic safety. Raw list/restore output and
stderr are not printed or retained. Original bundle bytes/checksums are never
rewritten to force compatibility. Its SOURCE target fingerprint deliberately need
not match the distinct TEST target; equality is not a restore prerequisite.

The manifest must be backup-v1 with canonical capture timestamp, exact ID/files,
positive size and matching actual/external SHA256. Its verified release metadata
must match the trusted checkout and all seven committed migration/snapshot/journal
file identities. Only these existing three migrations are supported:

- `0000_cupmemo_namespace`
- `0001_mixed_liz_osborn`
- `0002_needy_supernaut`

Their SQL, journal and snapshots are hash-pinned in `postgres-restore.mjs`.
Unknown/additional/missing/different files refuse before mutation. Future schema
needs an explicit reviewed profile, never generic SQL interpretation or silently
running today's migrations. The clean checkout is source identity, **not** a
capture-time database-state attestation. The manifest's
`release.databaseMigrationState='unverified'` is expected and honest. Actual
restored history is checked independently after restore.

The strict UTF-8 JSON expectation object has exactly these fields:

- `version`: integer2 (expectations/catalog only; backup bundle remains version1).
- `archiveSha256`: lowercase64hex, equal to external/archive/manifest hash.
- `releaseCommit`, `releaseTree`: lowercase40hex, equal to manifest/trusted checkout.
- `catalogSha256`: lowercase64hex of the canonical PG17 catalog below.
- `rowCounts`: exactly the ten keys below, canonical decimal **strings** (`0` or
  nonzero without leading zeros, at most20digits, maximum18446744073709551615).
- `observedAt`: canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ` custody reference time.

The row-count keys are `public.user`, `public.account`, `public.session`,
`public.verification`, `cupmemo.coffees`, `cupmemo.brews`, `cupmemo.brew_pours`,
`cupmemo.coffee_tasting_notes`, `cupmemo.brew_tasting_tags`,
`drizzle.__drizzle_migrations`. Explicit zero is valid. Missing/inferred/default
counts refuse; BigInt validation/string equality avoids Number precision loss.
Neither migration SQL nor a self-derived restored count is a trusted oracle.
Custody timestamps do not establish freshness or consistent source capture.
A future authorized source capture must reproduce native PG17 formatting and a
consistent snapshot privately; no capture job or real counts are delivered here.

Canonical catalog bytes are UTF-8 `JSON.stringify` with no indentation/newline,
object property order `{version:2,tables:[...],columns:[...],constraints:[...],indexes:[...]}`.
Each array sorts tuples lexicographically by fields (ordinal/code-point, not
locale; column ordinal numeric). Only `public`/`cupmemo`/`drizzle` objects enter:

- tables: `[schema,table,relkind,relpersistence,relrowsecurity,relforcerowsecurity]`
- columns: `[schema,table,ordinalNumber,columnName,format_type,notNullBoolean,defaultExpressionOrNull,identityCode,generatedCode]`
- constraints: `[schema,table,constraintName,typeCode,constraintDefinition,validatedBoolean,deferrableBoolean,deferredBoolean]`
- indexes: `[schema,table,indexName,indexDefinition,uniqueBoolean,primaryBoolean,validBoolean,readyBoolean]`

Definitions come from namespaced PG17 `format_type`, `pg_get_expr`,
`pg_get_constraintdef(oid,true)`, `pg_get_indexdef`, with `search_path=pg_catalog`.
Version2 uses the native pretty constraint representation on BOTH original source
capture and target: PG17 dump/restore can change native false-mode CHECK spelling
for this profile. Version1 expectations/catalog refuse, never silently relabel or
rehash retained v1 artifacts. Capture fresh independently trusted source-v2 bytes.
This is bounded to the hash-pinned migration profile, not arbitrary schemas.
Compare native output exactly: no regex, SQL normalization or ignored CHECKs.
All constraint metadata remains in the digest. No OIDs/owners/roles/ACLs/paths enter the digest. Columns omit
dropped/system attributes. Null is allowed only for a missing column default.
Exactly ten ordinary permanent non-RLS tables, supported validated constraints
and valid/ready indexes are required. History's sole integer serial sequence is
separately checked for fixed name, dependency on history.id and baseline settings;
its data/current value is not application acceptance. Unsupported user functions,
triggers, rules, policies, inheritance, custom types/operators/text search objects,
unexpected schemas/extensions and other unsupported relations refuse. There is
no broad sequence/function exemption or arbitrary SQL/identifier from the oracle.

## Target ownership, mutation and verification

The separately provisioned fresh empty PostgreSQL17 database must belong directly
to the dedicated login role. It cannot be superuser, createdb, createrole,
replication, bypass-RLS or a member of other roles. The authenticated database,
role, server loopback address and port must match configuration. Read-only
preflight rejects all non-system relations/sequences/views/functions and unexpected
schemas/extensions. Only empty public plus baseline catalogs/plpgsql are allowed.
Unknown, denied, unavailable or ambiguous query results mean STOP.

Exact name confirmation is accident protection, not endpoint ownership. Operator
must independently establish exclusive test-server control, privacy (including
restored sessions/hashes), storage, capacity and no external writers for the whole
run. No production endpoint/PGDATA can be reused. Advisory/file locks protect only
cooperating tools. The exclusive0600 lock uses a SHA256 key of test/loopback/port/DB,
excluding role/password/TLS so aliases and roles cannot split the same target.
All accepted loopback spellings share a conservative namespace. Separate servers
on IPv4/IPv6 at the same port/name can contend safely. A different state directory
or noncooperating writer bypasses the lock; it is not a server-wide ownership lock.

After source/oracle validation, version/list and read-only empty-target checks,
the only restore argv is:

```text
--single-transaction --exit-on-error --no-owner --no-privileges --no-password --dbname=<exact-decoded-test-name>
```

The archive is controlled stdin from a freshly validated descriptor, not shell or
manifest arguments. `--dbname` is necessary for pg_restore execution (without it,
pg_restore emits SQL rather than restoring). No clean/create/reset/drop/truncate,
role creation, source ownership/grants or current-code migration is performed.
Required isolated role provisioning and later grants need separate review: objects
belong to the restore role, not restored production owners. Recheck source hashes
and trusted release immediately before mutation. Exclusive custody must persist
across check/use boundaries; there is a TOCTOU/external-writer limitation.

The child receives only validated PG host/port/database/user/password/TLS,
10sec connection timeout, `PGPASSFILE=/dev/null`, application name and C locale.
No inherited PATH/HOME/Node/service/libpq redirect is passed. Certificate trust
uses libpq/platform defaults; establish trusted certificate custody separately.
Output limits are256bytes for version and16MiB for list/restore; output is suppressed.
SIGINT/SIGTERM/timeout terminates the foreground child, escalates after1sec and
awaits close. The tool is not a supervisor for malicious executable descendants.

Verification uses one checked-out client and a consistent repeatable-read,
read-only snapshot, fixed catalog search path, statement/lock timeouts and ROLLBACK.
It rechecks identity/role, catalog digest, existing read-only migration inspection
against the **historical** SQL/journal, all ten exact counts and eight zero-orphan
checks: account/user, session/user, coffee/owner, brew/owner, brew/(coffee,owner),
pour/brew, coffee-note/coffee, brew-tag/brew. Metadata constraints do not substitute
for actual aggregate relationship checks. No rows, hashes of passwords, sessions
or arbitrary expectation-supplied queries are printed.

## Receipts, failures and interrupted reconciliation

Private fsynced atomic0600 receipts record archive/oracle/release/catalog digests,
pseudonymous target identity, duration, completed phases and aggregate comparison
results, not values/SQL/credentials. A successful structural receipt says exactly
`status='structural_checks_passed'`, `recoveryVerified=false`,
`applicationChecks='unperformed'`. It does **not** prove known-good private values,
restored auth/session behavior or app recovery, even for an explicit empty match.

Failure is nonzero with fixed phase/outcome only. Once trusted inputs are validated,
a sanitized failure receipt is attempted; storage failure may leave only lock or
partial receipt evidence. Before mutation, the owned lock can be released; after
mutation starts, **any failure including postchecks/receipt publication preserves
the lock** and target. A successful durable structural receipt releases the lock,
not the outstanding recovery gate. A stale/foreign lock is never stolen.

pg_restore's single transaction supplies its normal failure rollback, not a
deletion routine. Disk/network interruption or unknown child outcome is still
**unknown**, not proof of rollback and never automatic destructive retry. Keep
source, target, locks, partial receipts and private evidence. Under separately
authorized inspection, establish that the exact runner/child are gone (PID alone
can be reused), reconcile target transaction/schema/data state and external writers,
and independently validate receipts/source. Do not delete data/history, edit
checksums, loosen guards, or run migrations to obtain a green status. Only the
owner may authorize quarantining an exact stale lock and a fresh isolated target
or reconciled retry. No cleanup of unknown targets is implemented.

Full Issue #48 acceptance still requires explicit real source custody/oracle,
actual safe non-production restore, representative known-good private data,
auth/sign-in/sign-out/owner-only application checks, reviewed persistence and
observed duration. Public cutover/deployment remains separately gated.

## Focused source verification

```sh
corepack pnpm --filter @cupmemo/database build
corepack pnpm exec vitest run tests/postgres-restore.test.mjs tests/postgres-restore-database.test.mjs tests/postgres-restore-oracle.test.mjs tests/postgres-backup.test.mjs tests/database-config.test.mjs tests/database-status.test.mjs --maxWorkers=1 --no-file-parallelism
corepack pnpm exec eslint infrastructure/scripts/postgres-restore*.mjs tests/postgres-restore*.test.mjs tests/helpers/restore-fixture.mjs
corepack pnpm exec prettier --ignore-path /dev/null --file-info docs/POSTGRES_RESTORE.md
corepack pnpm exec prettier --check --ignore-path /dev/null docs/POSTGRES_RESTORE.md
```

The ELF process fixture requires `/usr/bin/cc` (available on the hosted Linux
runner). It is compiled only in task-owned temporary SSD directories, never a
replacement PG binary installation. No PostgreSQL service or private inputs are
needed for these tests. A source/fixture/CI pass is not actual recovery evidence.
