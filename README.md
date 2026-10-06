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
design-reference/
```

## MVP design reference

CupMemo also has a reference package originally distributed as `coffee-mvp-reference.zip`.

It contains:
- `prototype.html` — clickable offline MVP prototype
- `MVP_SPEC.md` — detailed MVP screen/interaction specification
- `FLOW_MAP.md` — flow map
- screenshot/visual-review helper material

When the package is added to this repository, unpack it under `design-reference/`.

Use it as the concrete UI/interaction reference for the MVP. It complements the canonical product and architecture docs; it does not replace security, backend, deployment, or data rules.

## Canonical project documentation

Read these before making product or architectural changes:

- [Product](docs/PRODUCT.md)
- [MVP Flow](docs/MVP_FLOW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [Database](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Agent workflow](AGENTS.md)
- [MVP reference guidance](design-reference/README.md)

GitHub milestones and issues are the execution roadmap. The documentation above is the source of truth for product and architecture decisions. The MVP reference package is the visual and interaction reference where it is more specific.

If the reference package conflicts with an explicit current product decision, do not silently choose one; raise the conflict and update the source of truth.
