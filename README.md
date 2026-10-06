# CupMemo

CupMemo is a mobile-first coffee brewing journal for recording brews quickly, remembering what worked, and optionally capturing richer sensory notes without turning everyday brewing into a formal cupping session.

## Product principles

- Fast enough to use every morning
- Useful over time as a personal brew history
- SCA-inspired terminology without requiring a full cupping workflow
- Mobile-first and calm, with a **Clean Studio** visual direction
- Simple MVP architecture that can move from a Raspberry Pi to cloud infrastructure later without a rewrite

## MVP stack

- **Frontend:** Next.js + React + TypeScript
- **UI:** Tailwind CSS + shadcn/ui primitives
- **Backend:** Fastify + TypeScript
- **API:** REST under `/api/v1`, Zod validation, OpenAPI
- **Database:** PostgreSQL + Drizzle ORM
- **Authentication:** Better Auth
- **Package manager:** pnpm workspaces
- **Deployment:** Docker Compose on Raspberry Pi 5
- **Public ingress:** Cloudflare Tunnel
- **Private administration:** Tailscale + SSH

## Repository layout

```text
apps/
  web/
  api/
packages/
  database/
  contracts/
  ui/
  config/
infrastructure/
docs/
```

## Canonical project documentation

Read these before making product or architectural changes:

- [Product](docs/PRODUCT.md)
- [MVP Flow](docs/MVP_FLOW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [Database](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Agent workflow](AGENTS.md)

GitHub milestones and issues are the execution roadmap. The documentation above is the source of truth for product and architecture decisions.
