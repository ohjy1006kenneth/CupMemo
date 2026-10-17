# Backup verification and disaster recovery

## Status and authority

This is the Issue #49 **documentation checklist**, not evidence of working
backups or recovery. The [Issue #47 runner, retention engine and dormant schedule
templates](POSTGRES_BACKUPS.md) now exist in source; actual scheduled production
dumps and operational acceptance remain **unperformed**. An actual safe isolated
non-production restore (Issue #48) remains **unperformed**. Writing a dump,
checking its size or obtaining a successful job exit does not prove recovery.
Off-site copies are future work, not an available recovery source.

PGDATA provisioning, database startup, migrations/restores and public deployment
remain held. Every operational step below requires separate explicit authority
for the exact incident, resources and actions; this document grants none. Do not
change NAS/shares/sync/backup policy, repair permissions, mount disks, start Docker
workloads or touch unrelated services (including Hermes) to satisfy a checklist.
Unknown evidence is a STOP, not a reason to initialize a replacement database.

Contracts: [DATABASE.md](DATABASE.md), [DEPLOYMENT.md](DEPLOYMENT.md),
[PRIVATE_COMPOSE.md](PRIVATE_COMPOSE.md), [CONTAINER_IMAGES.md](CONTAINER_IMAGES.md),
[SAME_ORIGIN_ROUTING.md](SAME_ORIGIN_ROUTING.md) and
[NAS_ISOLATION.md](NAS_ISOLATION.md). The private Compose/startup/service sources
are dormant templates, not installed recovery machinery. Accepted hosted image
IDs do not establish local availability or authorize an image transfer/pull.

## 1. Establish the incident and preserve evidence

- [ ] Identify the incident owner, affected host/database/storage, last known-good
      application commit/image and data time, observed failure and suspected cause.
      Record authorized scope and a private incident log before mutation.
- [ ] Arrange a separately reviewed containment window for only affected CupMemo
      writes/services. Preserve failed state and known-good backups; do not overwrite
      the sole copy, rerun a failed migration, reset history or delete data to retry.
      Any forensic copy of live PGDATA needs its own consistent-copy plan; a casual
      filesystem copy of a running database is not a logical backup.
- [ ] Retain sanitized timestamps, exit codes, source/image identities, backup
      identifiers/checksums and decisions privately. Do not publish dumps, query
      output, raw SQL/errors, cookies, tokens, URLs with credentials or expanded
      environment/Compose configuration. Raw restore logs can contain private data.
- [ ] Establish available backup coverage and the actual potential loss window.
      RPO (acceptable data loss), RTO (acceptable outage), backup destination and
      failure-notification mechanism are **unresolved**; obtain owner decisions,
      not invented guarantees. Never report missing data as recovered.

## 2. Detect and qualify backup failures

This is a future operator verification checklist, not an installed job/monitor.
Issue #49 supplies no command or scheduler. The separate Issue #47 source runner
does not install a schedule or prove any real PostgreSQL dump/restore acceptance.

- [ ] After separately authorized Issue #47 activation, compare expected runs with actual completion times,
      exit status and private destination availability/capacity/permissions. Missing,
      late, empty/truncated, unreadable or failed copies are failures. Preserve the
      last known-good copy; do not rotate it away on the strength of a failed run.
- [ ] For each candidate, record capture time/timezone, source DB identity and PG
      version, dump format/tool version, size, integrity checksum, application
      commit/immutable images, committed migration journal/SQL hashes and declared
      schema/data/role coverage. Missing metadata means suitability is unverified.
- [ ] Compare recorded checksum with the selected stored copy; inspect archive
      readability/catalog using a trusted format-compatible tool before execution.
      A checksum alone proves neither completeness nor trustworthy origin. Treat
      restore input as executable, potentially privileged SQL; verify custody and
      provenance, not just a filename or modification time.
- [ ] Confirm coverage of `public` auth tables, `cupmemo` domain tables and
      `drizzle.__drizzle_migrations`, plus required ownership/grants/role metadata.
      A per-database logical dump must not be assumed to include cluster roles or
      external configuration/secrets. Retain required role definitions privately.
- [ ] Report failures to the incident owner through a separately selected private
      notification route, recording receipt and unresolved coverage. The repository
      does not currently implement automatic alert delivery or a backup dashboard.
- [ ] Mark a backup **restore-verified** only after the separately authorized
      Issue #48 isolated restore and application/data checks below actually pass.
      Record which exact copy/version was tested and when; do not generalize one
      result to future dumps or silently claim that #48 has run.

## 3. Rebuild inventory without secret values

Keep a recoverable, access-controlled inventory and secret/configuration custody
outside Git, outside public logs and separate from the failed host. Do not read or
copy credential files as part of this documentation task. No actual operator
values, endpoints, UID or storage destination are selected here.

| Required inventory        | Existing contract to preserve                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release and tools         | Exact source commit/tree, lockfile, committed Drizzle SQL and `meta/_journal.json`; Node24, pnpm10.34.6, trusted Linux ARM64 Docker/Compose (raw env-file support 2.30+) when separately authorized.                                                                                                                                                                                                           |
| Immutable images          | `CUPMEMO_WEB_IMAGE`, `CUPMEMO_API_IMAGE`, `CUPMEMO_POSTGRES_IMAGE`; verify provenance, ARM64, local availability and official PostgreSQL17 compatibility, not mutable tags or merely ID syntax.                                                                                                                                                                                                                |
| HDD and owner             | `POSTGRES_HDD_MOUNT`, `POSTGRES_HDD_UUID`, `POSTGRES_DATA_DIR`, `POSTGRES_DATA_UID`; independently verify device/UUID/ext4/fsroot, safe ancestry, positive numeric UID and exact0700/0750 data permissions. Never assume UID999 or root.                                                                                                                                                                       |
| Database identity         | `POSTGRES_DB`, `POSTGRES_USER`, required private role/ownership/grant definitions and password custody. The production URL must identify the same private database/role/password.                                                                                                                                                                                                                              |
| External files            | `CUPMEMO_API_ENV_FILE`, `POSTGRES_PASSWORD_FILE`, `CUPMEMO_DOCKER_CONFIG_DIR`; preserve trusted external paths, ownership, access and recoverable private contents. Docker client config/plugins/helpers are executable trust.                                                                                                                                                                                 |
| API runtime               | `NODE_ENV=production`, `CUPMEMO_DB_ENV=production`, `CUPMEMO_DATABASE_URL_PRODUCTION`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; API internal `CUPMEMO_API_HOST`/`CUPMEMO_API_PORT` are pinned by Compose. Restore the original auth secret through private custody, not Git. Any compromise/rotation requires a separate session/security decision.                                                            |
| Web routing               | `CUPMEMO_API_ORIGIN` must agree with the compiled private rewrite; `HOSTNAME`/`PORT` configure the standalone server. Current private contract is Next3101 -> separate Fastify4101 -> private PG5432, not published host ports. A runtime env edit does not retarget a compiled rewrite.                                                                                                                       |
| Future service            | If separately installed later, preserve exact reviewed rendered unit and `@CUPMEMO_RELEASE_DIR@`, `@CUPMEMO_STARTUP_ENV_FILE@`, `@CUPMEMO_OPERATOR_USER@` substitutions; current `.service.in` is uninstalled/disabled, not an enabled boot service.                                                                                                                                                           |
| Backup and future ingress | Private backup location/access, metadata, retention receipts and restore evidence when operationally accepted. `BACKUP_DIR` is now an explicit input to the dormant Issue #47 runner, not an installed backup service. `UPLOAD_DATA_DIR` and `CLOUDFLARE_TUNNEL_TOKEN` remain deployment expectations, not implemented services; preserve approved external config/credentials only when actually provisioned. |

Production commands do not implicitly load `.env`, select a default database or
fall back to legacy `DATABASE_URL`. Nonempty legacy `DATABASE_URL` is refused.
For isolated test CLI checks, explicitly use `CUPMEMO_DB_ENV=test`,
`CUPMEMO_DATABASE_URL_TEST` and matching loopback `CUPMEMO_TEST_DATABASE` named
`cupmemo_test_<task>`; do not inherit production mode/URL or `NODE_ENV=production`.
Name/loopback guards alone do not prove ownership or privacy. Restored auth data
includes password hashes, account details, sessions/tokens and personal journal
content: isolate the target and all copies from ordinary NAS users, sync and
broad backup jobs. Unknown rclone/future-job exclusions and NAS regeneration
privacy gates remain STOPs before PGDATA, not solved by this checklist.

## 4. Restore order and validation gates

1. **Authorize and verify storage first.** Independently establish mount/device
   identity and privacy on the selected host. Apply the existing HDD contract:
   no symlinks, nested mount/subdirectory-bind ambiguity, group/world-writable
   ancestry or root/SSD fallback. Missing HDD means no path creation and no DB
   start. A prior guard receipt is not reusable launch proof. Guard-before-launch
   has TOCTOU/hot-unmount limits; daemon/manual restart bypasses remain unresolved.
2. **Select matching artifacts and backup.** Reconcile section 2 metadata with
   source, image and migration versions. Select a separately authorized, isolated
   non-production PostgreSQL17 target and a reviewed format-specific restore plan,
   including required roles/ownership/grants, capacity and secret handling. Never
   point the trial at the live DB, reuse its PGDATA, or expose its restored sessions.
   Do not change backup contents to force a current application to accept them.
3. **Restore first, not migrate first.** Provision/start the isolated target only
   under that separate authority. Restore required role prerequisites and the
   selected logical backup's schema, data, constraints/indexes and migration
   bookkeeping in the order required by its format/dependencies. Do not run current
   application migrations into an empty target before loading an older logical
   restore. Do not layer it over the failed live database. Capture actual exit
   status and private diagnostics; any partial/error restore is not a success.
4. **Inspect schema and history before forward migration.** Compare the restored
   `public` (auth), `cupmemo` (domain), and `drizzle` (history) namespaces with the
   backup's matching committed `packages/database/drizzle/meta/_journal.json`
   and SQL checksums. At this revision the journal contains `0000_cupmemo_namespace`,
   `0001_mixed_liz_osborn`, `0002_needy_supernaut`; inspect the selected release,
   not this list as a permanent schema version. From a matching source checkout,
   the existing `corepack pnpm db:status` performs read-only history/hash comparison
   against the explicitly configured target. `current` is exit0; pending,
   mismatch/ahead and unavailable are exit1, not permission to rewrite history.
   It does not prove table contents or recovery completeness.
5. **Review any forward upgrade separately.** Only after backup-version validation,
   inspect intervening committed migrations, data effects and compatibility; test
   a separately authorized `corepack pnpm db:migrate` on the isolated restored
   copy, then repeat status and data checks. It mutates the selected DB and is
   never an automatic recovery/startup step. No reverse migrations or safe
   image-only rollback after schema/data changes are promised.
6. **Validate real data and application behavior privately.** Check expected auth
   users/accounts/session behavior, owner relationships, coffees, brews, ordered
   pours, quick/sensory assessments and child notes/tags against known-good private
   evidence (including counts and representative values). Verify constraints,
   sign-in/sign-out, cross-user denial, save/read/edit and persistence across an
   authorized restart using the matching app, without exporting private rows.
   Existing fixture integration harnesses are not a production-data restore test.
   `/health` is liveness; `/ready` is a DB query, not schema/data/auth acceptance;
   `pg_isready` is not authentication or migration validation.
7. **Request production cutover, do not infer it.** Retain exact backup checksum,
   source/image/journal identities, validation outcomes, actual loss window and
   observed restore duration. Ask for independent review and separate owner/user
   cutover authority with an exact-resource containment, data reconciliation and
   rollback plan. Preserve failed state and the pre-cutover copy. Decide how to
   handle writes since backup capture; never silently discard them. Production
   restore/startup, real HDD/reboot/restart evidence, privacy/capacity and any public
   HTTPS/tunnel gates remain separate. After authorized cutover, revalidate data,
   auth, readiness, persistence and backup coverage; do not delete old evidence as
   cleanup. No production recovery is performed by accepting this document.

## 5. Scenario entry points

| Incident                                | Required response before the restore/cutover gates above                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corrupted or missing live DB data       | Preserve failed state; distinguish connection/mount failure from actual loss before attempting repair. Choose a known-good copy predating corruption, record unrecoverable/newer writes, then follow sections 1–4. Never initialize an empty DB as a recovery claim.                                                                                                                                                                                                            |
| Bad migration or accidental data change | Record offending release/migration/time and contain affected writes under authority. Preserve both pre-change backup and failed state. Restore into isolation at the backup's schema version, verify history/data, then review the forward fix and cutover. Reverting code/images alone does not undo data or schema changes; do not edit the Drizzle journal to hide a failure.                                                                                                |
| External HDD unavailable                | Fail closed: keep DB stopped; do not mkdir/init a same-named root/SSD directory, change the bind, or bypass the guard. Establish device/mount health with an authorized operator. If safely returning the original disk, reverify identity/privacy and assess integrity before restart; if lost, use an independently approved replacement HDD and isolated restore first. Never format/repartition/wipe as an incidental fix.                                                  |
| Replacement Pi/server                   | Rebuild from the inventory, not assumptions about old paths/device IDs. Independently verify replacement hardware/ARM64 images, HDD identity/privacy/UID, private secret custody and capacity alongside existing workloads. Different architecture/image/storage contracts need separate review, not a silent substitution. Follow isolated restore and cutover gates; do not copy an unverified unit or enable public ingress.                                                 |
| Container stack recreation              | Recreating containers is **not data recreation**. Preserve the exact verified HDD bind and existing data; first decide whether data is healthy or a restore is needed. Reconcile surviving daemon-side containers after interruption before retrying. Never use volume deletion, PGDATA deletion, broad down/prune or unrelated-service cleanup. Verify immutable local images, configuration, guard and exact owned resources; dormant templates are not permission to launch. |

For future authorized recreation preserve `create_host_path: false`, PG17 bind
`/var/lib/postgresql/data` with `PGDATA=/var/lib/postgresql/data/pgdata`, private
frontend/backend networks, no published DB/API ports and `restart: 'no'`. Preserve
web512MiB / API256MiB / PG512MiB (PG provisional), memory-swap equal to memory,
CPU1 and pids128 each, existing nonroot/security/log controls. These are accepted
configuration limits, not measured full-stack Pi capacity or restart protection.
The startup wrapper is a held foreground interface, not a supervisor; killing it
is not proof daemon-side containers stopped. Eventual ingress targets Next only,
never a new public Fastify or PostgreSQL endpoint.

## 6. Explicit future follow-up

- Issue #47: separately activate and accept actual scheduled dumps, private
  destination, failure visibility and the source engine's 7 daily / 4 weekly / 3
  monthly retention. No schedule is installed or running by this source change.
- Issue #48: perform and retain a separately authorized safe non-production restore
  with the actual copy, migration/data/auth validation and observed duration. No
  restore success is claimed by this documentation or by merely writing a dump.
- Future off-site backup work: owner must choose destination, encryption/key custody,
  access/privacy, transfer and integrity verification, retention and restore drills.
  An optional SSD copy is not off-site and may share the host's failure domain.
  No remote copy, provider, credentials, job or new follow-up card is created here.
- Set RPO/RTO and notification ownership/mechanism once operational evidence and
  policy decisions exist. Keep Issue #11/#32/#41/#42 activation and public-deployment
  criteria incomplete until their own actual checks and explicit gates pass.
