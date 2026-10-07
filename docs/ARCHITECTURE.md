# CupMemo Architecture

## Goals

CupMemo should be:
- simple enough to run on a Raspberry Pi 5
- easy for multiple coding agents to understand
- maintainable
- secure as an internet-facing application
- movable to managed/cloud infrastructure later without a rewrite

Scale through clean boundaries, not premature infrastructure.

## Approved stack

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui primitives
- PWA

### Backend
- Fastify
- TypeScript
- Zod
- REST API
- OpenAPI

### Data
- PostgreSQL
- Drizzle ORM

### Authentication
- Better Auth

### Tooling
- pnpm workspaces
- GitHub
- GitHub Actions
- Docker Compose

## Service boundary

```text
Next.js PWA
     |
     | REST /api/v1
     v
Fastify API
     |
     v
PostgreSQL
```

The Fastify API is a separate service.

Do not move core business logic into Next.js route handlers or server actions simply for convenience.

This boundary allows future clients:

```text
Next.js Web/PWA ----+
                    |
Expo iOS/Android ---+--> Fastify API --> PostgreSQL
```

Expo is future scope, not MVP.

## Repository structure

The pnpm workspace contains exactly six initial members: `@cupmemo/web` and `@cupmemo/api` under `apps/`; `@cupmemo/database`, `@cupmemo/contracts`, `@cupmemo/ui`, and `@cupmemo/config` under `packages/`. Applications may depend on shared packages, never the reverse. Database is server-only (API consumer); contracts are persistence-independent (both apps); UI is consumed by web, not API; config is development-only tooling. Foundation entrypoints do not imply product behavior. Add further workspace members only through an explicit scope decision.

Target:

```text
cupmemo/
  apps/
    web/
    api/
  packages/
    database/
    contracts/
    ui/
    config/
  infrastructure/
    docker/
    scripts/
    compose.yml
  docs/
    DECISIONS/
```

## API conventions

- REST under `/api/v1`
- Zod validation at boundaries
- consistent errors
- authenticated ownership checks
- explicit contracts
- OpenAPI documentation

Example style:

```text
GET    /api/v1/brews
POST   /api/v1/brews
GET    /api/v1/brews/:id
PATCH  /api/v1/brews/:id
DELETE /api/v1/brews/:id
```

Do not expose raw persistence structures as API contracts when that creates unnecessary coupling.

## Security principles

Treat the MVP as a real internet-facing app.

At minimum:
- authorize every private resource
- scope user-owned data by authenticated identity
- prevent IDOR
- validate all API input
- use secure session/cookie settings
- avoid production stack traces
- protect secrets
- validate uploads if introduced
- keep PostgreSQL private
- use least privilege where practical

## Application authorization foundation

`apps/api/src/authorization.ts` provides `requireAuthenticatedUser(auth)` as a
Fastify preHandler. `server.ts` passes `api.getSession` from the same Better Auth
instance that serves the existing authentication transport. `/api/v1/me` is the
only application endpoint added by this foundation; it exposes only authenticated
`id`, `name`, and `email`. Health/readiness remain public. Missing dependencies,
malformed authority, exceptions, or the 1500 ms lookup deadline fail closed with
generic 503; missing, tampered, expired, or revoked sessions receive generic 401.
No private handler executes after denial. The deadline bounds the response, not
driver cancellation: the existing shared bounded pool separately enforces
connection/query/statement limits and drains on shutdown.

Application lookups disable cookie cache and per-request refresh. They do not
extend valid sessions or issue renewed credentials. Pinned Better Auth may delete
the expired incoming session and clear stale auth cookies; those cleanup-only
effects are allowed, and supported `returnHeaders` cookie clears are preserved.
Other library headers are not forwarded over application policy. Normal browser
auth transport retains its existing sliding-session behavior. Protected responses
use `Cache-Control: no-store` and preserve existing `Vary` values while adding
`Cookie`. Do not log sessions, cookies, tokens, or raw lookup errors.

Guarded POST/PUT/PATCH/DELETE requests require exact configured application Origin
and reject explicit cross-site Fetch Metadata with generic 403. Missing/null or
non-exact Origin is denied before lookup/mutation. Nonbrowser mutation callers
must supply that Origin. Host/forwarded headers never establish trust. Better
Auth's separate CSRF/transport defenses are unchanged.

Every future private-resource query must scope ownership **in SQL**:

```ts
db.select().from(resources).where(ownerScope(resources.ownerId, request.authenticatedUser));
db.update(resources).set(validatedChanges).where(
  ownedResourceScope(resources.id, resources.ownerId, resourceId, request.authenticatedUser),
);
```

The examples assume the guard has populated the non-null principal; handlers must
retain that invariant. The helpers require nonempty principal/resource IDs and
compatible string-valued PostgreSQL columns. Use the collection predicate for
lists and the combined ID/owner predicate for SELECT/UPDATE/DELETE. Never fetch by
ID first and authorize afterwards, accept a caller-selected owner, or omit an
undefined predicate. Create ownership comes only from authenticated identity;
reject ownership reassignment in input validation. Return identical
`404 {"message":"Resource not found"}` for missing and foreign rows, without an
existence lookup. Project response fields explicitly, excluding persistence
credentials and private attributes.

`corepack pnpm authorization:test:integration` fails rather than skips without
explicit guarded test DB configuration and strong local Better Auth configuration.
It uses real Better Auth users/cookies, an exact marked disposable schema, actual
Drizzle queries and the production guard/predicates. Fixture routes exist only in
the harness, never behind a production environment flag. Cleanup removes only
that verified schema and exact generated auth users, then drains the owned pool.
Phase 5 domain routes/schema are not implemented or declared authorized by this
foundation: each future resource must adopt this pattern and retest its own
cross-user boundary.

## Storage abstraction

If user uploads are introduced, application logic should depend on a storage abstraction rather than raw filesystem calls everywhere.

Conceptually:

```text
StorageService
  save()
  delete()
  getUrl()
```

Initial provider may be local disk. Future provider may be S3/R2 without changing domain logic.

## Scalability

Do not introduce during MVP without a real requirement:
- Kubernetes
- Redis
- Kafka
- RabbitMQ
- Elasticsearch
- microservices
- service mesh

Future migration may move:
- Next.js to Vercel/Cloudflare/AWS
- Fastify to ECS/EC2/Fly/Render/etc.
- PostgreSQL to RDS or another managed PostgreSQL
- uploads to S3/R2

Application boundaries should make those deployment changes possible with minimal product-code changes.

## Health and logging

Backend should provide basic health/readiness endpoints such as:

```text
GET /health
GET /ready
```

Use structured logging and never log passwords, tokens, session secrets, or equivalent credentials.
