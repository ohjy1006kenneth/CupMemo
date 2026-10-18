# Disposable synthetic recovery drill (Refs #48)

This is the separately authorized synthetic-data-only integration lane for the
[guarded restore tool](POSTGRES_RESTORE.md), not production recovery, scheduled
backup acceptance, public deployment or permission to start the Pi database.
Source tests alone do not prove this drill passed. Acceptance requires the exact
candidate's successful hosted run, its original sanitized artifacts, independent
technical/runtime review and owner adjudication.

## Boundary and execution

`.github/workflows/recovery-drill.yml` executes changed recovery tooling on a
native GitHub-hosted `ubuntu-24.04-arm` runner before merge. It checks out the
exact PR head with no persisted credentials, uses the pinned Node24/package
manager and frozen lockfile, and builds only the backend prerequisites. The
canonical CI workflow is unchanged. No repository secrets, existing data,
production URLs, environment files or private host backups are inputs.

`infrastructure/scripts/recovery-drill.py` refuses outside hosted ARM64. It
creates one uniquely run/attempt-labelled container and volume, with no published
ports, using the immutable official PG17.6 image. It verifies Docker's memory/swap
capability, effective512MiB memory/memory-swap settings and actual live cgroup-v2
`memory.max=536870912`, `memory.swap.max=0`, CPU1, pids128 and restart=no **before**
initializing fixture data. Unsupported enforcement fails closed. It installs git
only in that disposable container for the unchanged release validators and mounts
the exact checkout and genuine Node executable read-only. Real versioned PG17
binaries are used, never wrappers or fake executable exemptions.

The container's PostgreSQL listens only on its own loopback. Local socket trust
is used only by the task's bootstrap administrator; dedicated source/target
owners authenticate over TCP with generated SCRAM credentials and cannot create
roles/databases or acquire superuser privileges. The drill verifies both empty
identities before source migrations. Loopback `sslmode=disable` is explicit: this
is not a TLS-handshake test.

## Real checks and oracle custody

The inner `recovery-drill.mjs` worker performs these phases without raw logging:

1. Apply committed migrations to the source only. Create two real Better Auth
   accounts/sessions and coffee/brew/pour/sensory/note/tag graphs through the
   production API. Close source application activity before capture.
2. Independently query the **original source** under repeatable-read/read-only
   snapshots for all ten exact table contents, row counts, native PG17 catalog
   fingerprint and migration-history sequence state. Invoke the actual backup
   runner to produce the original custom compressed archive and immutable
   backup-v1 manifest. Verify source state unchanged across the dump. Bind the
   external oracle to the actual archive hash and trusted clean release identity.
3. Exercise production-mode, wrong-confirmation and wrong-digest refusals and
   reverify target emptiness after each. Run the actual guarded restore with the
   dedicated nonsuperuser owner into the separate empty target. Require its
   structural receipt, all ten exact original-source table contents and sequence
   equality. Refuse a second restore over the nonempty target and prove all
   values, catalog and sequence remain unchanged.
4. Use restored original sessions and real sign-in/session/sign-out; exercise
   two-owner coffee/brew read/update isolation through the production API. Read
   representative exact values, edit an owned brew and retain expected results
   privately. Restart only this task's DB container once, recheck live resource
   caps, then verify persisted session, exact edited brew, fresh sign-in and
   revocation. Recheck the original source remains unchanged.

Source and restored snapshots are never conflated. All rows, archives, passwords,
password hashes, cookies, session tokens and oracle JSON stay in private ephemeral
storage, never Git, stdout or uploaded artifacts. The structural tool's honest
`recoveryVerified=false` / `applicationChecks=unperformed` receipt is unchanged;
the distinct drill results record only the application checks actually executed.

## Evidence, failure and cleanup

The workflow uploads an explicit allowlist of phase/status/count/timing reports,
source/image/archive/oracle identities, cgroup samples and cleanup status. It does
not upload the private fixture directory, raw Docker inspection/environment,
child stderr, SQL, row values or database logs. A failed phase remains failed;
there is no target reset, archive rewrite, lock stealing or automatic retry.
Preserve failed and corrected run artifacts separately.

`finally` and the workflow's `always()` cleanup target only recorded hosted
container/volume identities after checking exact task/run labels. No broad prune,
Compose down, host setting change or other workload action exists. Hosted storage
is disposable after the job; the sanitized downloadable evidence survives for
independent review. The earlier Pi fixture stays stopped/preserved because its
kernel discarded mandatory memory/swap limits. Do not restart or delete it as
part of this hosted lane.

Issue #47 actual scheduled production backups, #11 NAS/privacy, production runtime
and public deployment remain held regardless of a successful synthetic drill.
Only the owner may accept Issue #48 after reviewing exact-head real evidence.
