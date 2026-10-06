# CupMemo

## Workspace foundation

Use Node.js 24 and pnpm 10.34.6 (provided by Corepack). From the repository root, install with `corepack pnpm install --frozen-lockfile`. Run `corepack pnpm format` to format, then `corepack pnpm format:check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build` for the quality gates. Workspace member commands can be run with `corepack pnpm --filter @cupmemo/<member> <script>`.

GitHub Actions runs the same frozen install and quality gates for pull requests and pushes to `main`. The initial workflow intentionally does not cache dependencies, keeping its install behavior straightforward and avoiding cache-key/store-order risks. Contract tests inspect the committed workflow source for key triggers and commands; they are not a YAML or GitHub Actions execution substitute. The actual GitHub Actions run is authoritative.

The six workspace members are `@cupmemo/web`, `@cupmemo/api`, `@cupmemo/database`, `@cupmemo/contracts`, `@cupmemo/ui`, and `@cupmemo/config`. Apps may consume shared packages; shared packages must not depend on apps. The database package is server-only and belongs behind the API, contracts remain persistence-independent for both apps, UI is for web only, and config is development tooling only. These packages currently establish boundaries, not product features; application scaffolding and quality/test tooling are separate outcomes.

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
