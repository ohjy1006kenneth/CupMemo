# CupMemo Database

## Technology

- PostgreSQL
- Drizzle ORM
- explicit migrations committed to Git

PostgreSQL is the main application database.

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

Maintain clearly distinct:
- development
- test
- production

Tests must not point at production.

Destructive test helpers should include safeguards against production configuration.

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
