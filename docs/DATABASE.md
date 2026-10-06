# CupMemo Database

## Technology

- PostgreSQL
- Drizzle ORM
- explicit migrations committed to Git

PostgreSQL is the main application database.

## Connection and application namespace

`@cupmemo/database` exports `createDatabase(DATABASE_URL)`, which returns a typed Drizzle database, its `pg` pool, and an explicit `close()` lifecycle. It never connects at import time and has no implicit localhost/production URL. Missing or malformed configuration throws a non-secret error; connection and migration failures fail visibly. Callers must close the pool in `finally` blocks. Driver background errors are not logged because they can include connection details.

The committed initial migration creates the `cupmemo` PostgreSQL application namespace. It deliberately creates no domain tables: Better Auth owns its adapter schema and the domain model is defined in its feature work. Drizzle's migration bookkeeping stays in its default `drizzle.__drizzle_migrations` namespace, with its normal `public` namespace untouched; later auth tables may use `public`, and CupMemo domain tables use `cupmemo`. Use explicit migrations for schema changes, not `drizzle-kit push`. `db:generate` reads the schema entry point and writes migrations under `packages/database/drizzle`.

For new temporal columns, prefer timezone-aware timestamps (`timestamptz`); use UUID identifiers, foreign keys, not-null and uniqueness constraints where the domain requires them, and indexes only for known lookup/sort paths. These are modeling conventions, not a schema added by this foundation.

## Local development and integration

The isolated development service is `infrastructure/docker/database.compose.yml`; it is loopback-only on port 55432 with non-production example credentials and a uniquely named Compose volume. It is separate from production infrastructure. Copy `.env.example` to `.env` only as a local reference and set `CUPMEMO_DB_ENV=development` with `CUPMEMO_DATABASE_URL_DEVELOPMENT` when running configuration-driven commands. Package scripts do not implicitly load `.env`; keep local secret files out of version control.

Integration checks are opt-in and never run as part of ordinary root `pnpm test`. They require `CUPMEMO_DB_ENV=test`, `CUPMEMO_DATABASE_URL_TEST`, and `CUPMEMO_TEST_DATABASE`; the decoded URL database must match `cupmemo_test_<task>` and target loopback. Use a task-owned disposable PostgreSQL database; the helper refuses other identifiers and does not drop/reset databases. The check verifies PostgreSQL 17, the namespace and single migration history entry, a real transaction/query round-trip, configuration refusal, unavailable-server error handling, and pool shutdown. It fails rather than skipping if prerequisites are absent. Configuration-driven commands reject nonempty legacy `DATABASE_URL`; there is no environment or URL fallback.

Do not use SQLite, MongoDB, Firebase, or another primary database without an approved architecture change.

## Modeling principles

Use normal relational modeling.

Prefer explicit columns and relationships for known structured domain data.

Do not place important structured data into JSON/JSONB merely because it is convenient.

Use JSON only where flexibility is genuinely valuable.

## MVP domain

The exact schema should be derived from `docs/MVP_FLOW.md` and refined during Phase 5.

Expected domains include:
- users/auth data
- coffees
- brews
- recipe/brew parameters
- quick evaluation
- optional Sensory Detail
- equipment only where required by the MVP

Do not build a speculative large schema.

## Sensory model

Canonical primary dimensions:

- Acidity
- Body
- Aftertaste

A brew must be valid without Sensory Detail.

There is no Cup Checks model.

## Ownership

All private user-owned data must be scoped to the authenticated user.

Never fetch a resource by public/client ID alone and assume possession of the ID grants access.

Representative authorization behavior must be tested.

## Constraints

Use appropriate:
- primary keys
- foreign keys
- not-null constraints
- uniqueness constraints
- timestamps
- indexes

Do not index everything automatically.

Add indexes based on actual lookup/sort patterns.

## Migrations

Schema changes must use committed migrations.

Do not manually mutate production schema when a migration should exist.

Migration failures should fail visibly.

## Environment separation

### Environment configuration

All configuration-driven database CLI and integration-test workflows use an explicit `CUPMEMO_DB_ENV` set to exactly `development`, `test`, or `production`, plus the matching dedicated URL:

- `CUPMEMO_DATABASE_URL_DEVELOPMENT`
- `CUPMEMO_DATABASE_URL_TEST`
- `CUPMEMO_DATABASE_URL_PRODUCTION`

There is no default mode or URL. `NODE_ENV` never selects a database; `NODE_ENV=production` is compatible only with production DB mode. A nonempty legacy `DATABASE_URL` is rejected as ambiguous. Connection URL query options that can change the effective PostgreSQL target or session settings are refused; only one `sslmode` option is accepted for TLS configuration. This prevents driver query parameters from overriding validated authority host, port, or database. Do not define `.env` loading in commands: local `.env` files are ignored and must be loaded explicitly by a developer tool if desired.

Example development setup (Compose binds PostgreSQL to loopback port 55432):

```sh
corepack pnpm install --frozen-lockfile
docker compose -f infrastructure/docker/database.compose.yml up -d
CUPMEMO_DB_ENV=development CUPMEMO_DATABASE_URL_DEVELOPMENT=postgresql://cupmemo:<password>@127.0.0.1:55432/cupmemo_dev corepack pnpm db:migrate
```

Integration tests must use a disposable, task-owned local PostgreSQL instance and a unique database name. The resolver requires `CUPMEMO_TEST_DATABASE` to match `cupmemo_test_<task>`, requires the selected URL's decoded database name to match it, and accepts only loopback hosts (`localhost`, `127.0.0.1`, `::1`). For example:

```sh
CUPMEMO_DB_ENV=test CUPMEMO_DATABASE_URL_TEST=postgresql://cupmemo:<password>@127.0.0.1:<ephemeral-port>/cupmemo_test_<task> CUPMEMO_TEST_DATABASE=cupmemo_test_<task> corepack pnpm db:migrate
CUPMEMO_DB_ENV=test CUPMEMO_DATABASE_URL_TEST=postgresql://cupmemo:<password>@127.0.0.1:<ephemeral-port>/cupmemo_test_<task> CUPMEMO_TEST_DATABASE=cupmemo_test_<task> corepack pnpm db:test:integration
```

Replace placeholders locally; never include actual credentials in committed docs or logs. Name/loopback guards do not establish endpoint ownership or isolation. Users are responsible for connecting only to a trusted disposable server. Integration checks verify current database identity before running a temporary transaction probe; they do not reset or drop a database.

Production configuration uses `CUPMEMO_DB_ENV=production` and `CUPMEMO_DATABASE_URL_PRODUCTION`; it can be syntax/target-validated without connecting. Production mode rejects `cupmemo_dev` and `cupmemo_test_*`. This documentation does not authorize production connections, deployments, or selection of production storage paths. Missing/invalid mode, absent selected URL, unsupported scheme, absent database name, conflicting `NODE_ENV`, reused configured targets, test-name/host mismatches, and legacy `DATABASE_URL` all fail visibly without printing credential values. Unselected mode URLs need not be set but are validated for syntax and cross-mode target reuse when provided.

Database configuration errors are intentionally generic and never echo URLs, passwords, or query credentials. Generation (`corepack pnpm db:generate`) remains offline and does not require a database URL. Migration failures return nonzero and close any created pool.

## Production storage

Production PostgreSQL data lives on the Raspberry Pi's **external HDD**.

The repository and normal application files live on the **SSD**.

The production DB path must be environment-configurable.

Example concept only:

```text
POSTGRES_DATA_DIR=/verified/hdd/path/cupmemo/postgres
```

Do not assume the actual mount path.

Before production configuration, inspect the Pi with commands such as:

```bash
lsblk -f
findmnt
df -h
```

Never format, repartition, wipe, or destructively modify a disk as part of CupMemo setup.

## HDD mount safety

Critical requirement:

If the HDD is not mounted, PostgreSQL must **not** silently start using a same-named directory on the SSD/root filesystem.

Production startup must verify the expected path is an actual mounted filesystem.

If the mount is unavailable, startup should fail safely.

The deployment mechanism may use a mount preflight check, systemd `RequiresMountsFor=`, or another reliable solution.

## PostgreSQL networking

Keep PostgreSQL private.

The API should connect through the private Docker network.

Do not publicly expose port 5432.

Administration from the developer machine should normally happen through Tailscale/SSH.

## Backups

Initial retention target:

- 7 daily
- 4 weekly
- 3 monthly

A backup is not considered proven until a restore has been successfully tested in a safe non-production environment.
