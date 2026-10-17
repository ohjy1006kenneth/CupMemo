# Same-origin production routing (Refs #41)

Primary `hq/t_d2555f45`; original implementer `code-monkey-cupmemo`, run3317.
This is isolated source/configuration verification, **not a deployed service**.
Issue41 remains open until authorized real runtime/public acceptance.

## Selected boundary

Next is the sole eventual external application origin. Its existing
`apps/web/next.config.ts` rewrite forwards `/api/v1/:path*` to the separate,
server-only `CUPMEMO_API_ORIGIN`, preserving the versioned path. No new proxy,
Next API handler, public API variable or direct browser Fastify origin is added.
The origin validator rejects credentials, non-HTTP protocols and non-root
paths/query/fragment components; invalid configuration fails at build/start.

The production web image compiles `http://cupmemo-api:4101` into its rewrite.
Changing a runtime variable does **not** retarget an already compiled rewrite:
build and runtime server-session configuration must agree. The dormant private
Compose candidate pins both to that internal service and publishes no ports.
See [PRIVATE_COMPOSE.md](PRIVATE_COMPOSE.md): it deliberately has no external
entry point and is not a deployment authorization. Any future authorized ingress
must target Next only; do not add a separate public Fastify route.

Browser application fetches use relative `/api/v1/...` URLs. The official auth
client explicitly uses `window.location.origin` plus `/api/v1/auth`. Server session
checks use the validated internal origin, not caller-controlled Host headers.
Fastify remains responsible for auth, authorization, cookie issuance and CSRF;
Next transports their responses. Same-origin requests require no credentialed
cross-origin CORS policy. Fastify does not opt foreign browser origins into CORS;
application mutations still require the exact configured Origin. Lack of CORS
headers alone is not CSRF protection. Preserve the existing Better Auth defenses,
HttpOnly/Lax/production-Secure cookie policy, no-store and Vary: Cookie behavior.
See [AUTH_FRONTEND.md](AUTH_FRONTEND.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Executable isolated verification

Prerequisites: pinned Node24/pnpm dependencies installed with the frozen lockfile,
`/usr/bin/chromium`, adequate memory for one production build, and no dotenv files
in the repository root or `apps/web`. The runner refuses Next's implicit dotenv
files without reading them. It passes a minimal nonsecret child environment;
it never starts the API server, connects to a database or contacts Docker.

From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @cupmemo/database build
corepack pnpm exec vitest run tests/web-config.test.mjs tests/same-origin.test.mjs tests/api.test.mjs tests/auth.test.mjs tests/authorization.test.mjs tests/auth-session.test.mjs --maxWorkers=1 --no-file-parallelism
node scripts/production-routing.mjs
```

On the shared Pi, check available memory/processes first and run no competing
heavy suite. The runner gives its single build five minutes and a1536MiB V8 heap
ceiling; this is not a total process-group memory limit. A caller may additionally
use `taskset` with an available CPU. It never kills unrelated processes or
modifies global build settings.

The runner builds the **actual Next production application**, then assembles and
runs its emitted standalone server with the same public/static layout as the web
Dockerfile. A task-owned Node HTTP fixture binds only127.0.0.1 at an ephemeral
port. Next also binds only127.0.0.1. Neither is publicly exposed. The fixture is
an explicitly synthetic **HTTP transport control**, not Fastify or Better Auth.

Checks exercise:

- The compiled manifest has exactly the internal versioned rewrite.
- Exact encoded path, repeated query values, Origin/custom header/literal Cookie
  transport, six HTTP methods, body bytes, HEAD behavior and response status.
- Two separate Set-Cookie fields, no-store and preserved Vary: Cookie (Next may
  additionally vary compression by Accept-Encoding).
- Non-v1 paths do not reach the fixture.
- Real Chromium loads the compiled sign-in page and submits its **actual official
  auth client**. The fixture intentionally rejects it; no account/login success
  is asserted. Browser requests and a relative fetch stay on the Next origin.
- Synthetic HttpOnly/Lax cookies reach the browser. This loopback HTTP control
  does not prove production Secure/HTTPS cookie handling.
- Stopping the owned fixture produces Next's generic500 `Internal Server Error`,
  not a stack, connection error or internal origin in the browser response.

Processes have task-owned groups and deterministic termination, including failure
and ordinary interruption. The runner retains private logs and a compact result
under ignored `test-results/production-routing-*`; it does not save browser
storage state, traces, video or production data. Expected upstream-refusal detail
may appear in the private server log, never the response. It does not claim all
server diagnostics are free of internal operational details.

`node scripts/production-routing.mjs --built` reuses the existing standalone
build, binding the fixture to its compiled **loopback-only** upstream port. It
fails if that port is occupied; it does not reuse/stop the occupant. This option
is for interrupted affected checks only: the **caller must establish unchanged
application/build-input identity** and retain the successful original build log.
It does not rebuild or independently attest source identity. For a new candidate,
use the default full command in an isolated checkout. Do not run two instances
against the same `.next` directory.

The focused `same-origin.test.mjs` independently exercises actual Fastify route
registration, default loopback configuration, production auth-origin validation,
foreign CORS/preflight refusal and foreign-mutation denial without a DB. Its
injected auth handler is explicitly not a real Better Auth acceptance result.
Existing API/auth/authorization/session tests remain separate from the transport
control. The unchanged DB/auth/browser verification documented in
AUTH_FRONTEND is prior accepted evidence only, not rerun or expanded here.

## Acceptance limits and rollback

No UI, auth policy, route/schema, lockfile, service, Docker image, HDD/NAS or
public ingress change is delivered. No new rendered visual lane is required for
this transport/config-only delta. Independent technical review and owner
acceptance/integration still apply to this exact candidate.

Still unverified/held: real production Fastify/Better Auth/PostgreSQL traffic,
public hostname/HTTPS/tunnel behavior, production Secure-cookie lifecycle,
physical-phone/runtime capacity/restart behavior and actual network isolation.
No fixtures/local HTTP result closes Issue41 or authorizes activation. The
Issue11/32 PGDATA/database/public-deployment holds remain intact. Revert only this
source/test/documentation delta to roll back; there are no deployed resources or
persistent data created by it.
