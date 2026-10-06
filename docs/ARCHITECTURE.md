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
