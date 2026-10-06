# CupMemo

## Workspace foundation

Use Node.js 24 and pnpm 10.34.6 (provided by Corepack). From the repository root, install with `corepack pnpm install --frozen-lockfile`. Run `corepack pnpm format` to format, then `corepack pnpm format:check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build` for the quality gates. Workspace member commands can be run with `corepack pnpm --filter @cupmemo/<member> <script>`.

GitHub Actions runs the same frozen install and quality gates for pull requests and pushes to `main`. The initial workflow intentionally does not cache dependencies, keeping its install behavior straightforward and avoiding cache-key/store-order risks. Contract tests inspect the committed workflow source for key triggers and commands; they are not a YAML or GitHub Actions execution substitute. The actual GitHub Actions run is authoritative.

## Local runtime scaffold (Refs #7)

This is a development scaffold, not the signed-in CupMemo product. It runs a Next.js App Router web app and a separate Fastify API. No authentication or brew/domain endpoints are implemented. API readiness checks the configured database; see [database operations](docs/DATABASE.md#readiness-and-migration-status). The minimal web manifest is metadata only: installability, icons, service worker, and offline behavior are not implemented or verified.

Use Node.js 24 and pnpm 10.34.6. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @cupmemo/api dev
```

In a second terminal:

```sh
corepack pnpm --filter @cupmemo/web dev
```

The web server binds to `127.0.0.1:3101`; the API binds to `127.0.0.1:4101`. The page checks `/api/v1/health` via a server-side Next.js rewrite to Fastify. Override the API listener with `CUPMEMO_API_HOST` and `CUPMEMO_API_PORT`, and configure the rewrite target with server-only `CUPMEMO_API_ORIGIN` (HTTP(S) URL without credentials). Do not use `NEXT_PUBLIC_` for the API origin. The API port must be an integer from 1 through 65535. Liveness responses are exactly `{"status":"ok"}`; `/health` and `/api/v1/health` are process-only diagnostics. `/ready` is database-aware and can return 503 while the API remains live.

For production compilation and local starts:

```sh
corepack pnpm --filter @cupmemo/api build
corepack pnpm --filter @cupmemo/web build
corepack pnpm --filter @cupmemo/api start
corepack pnpm --filter @cupmemo/web start
```

The same listener ports apply to `start`; set `CUPMEMO_API_PORT` to a free port and match `CUPMEMO_API_ORIGIN` when needed. The API requires explicit database mode/URL configuration before it listens. It closes its pool on SIGINT/SIGTERM.

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

## Database configuration

Database commands require an explicit `CUPMEMO_DB_ENV` (`development`, `test`, or `production`) and the corresponding `CUPMEMO_DATABASE_URL_<MODE>` variable. See [Database configuration and safety](docs/DATABASE.md#environment-configuration) for isolated examples, refusals, and migration/test commands. `.env` files are ignored and are never loaded automatically.

## Local PostgreSQL development

Start only CupMemo's local database with `docker compose -f infrastructure/docker/database.compose.yml up -d`. Set explicit `CUPMEMO_DB_ENV=development` and `CUPMEMO_DATABASE_URL_DEVELOPMENT` for `corepack pnpm db:status` or `corepack pnpm db:migrate`; pnpm does not load `.env` files. Status compares committed migrations read-only; migration is a deliberate operator action. `corepack pnpm db:generate` remains offline. PostgreSQL is bound to loopback port 55432 and this development-only Compose file is not the production stack. See [database operations](docs/DATABASE.md#readiness-and-migration-status), including `down` without deleting its volume. Production HDD startup protection remains separately gated by issue #11; this documentation does not authorize deployment.
