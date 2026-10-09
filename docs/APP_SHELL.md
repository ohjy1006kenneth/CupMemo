# Authenticated app shell (Refs #22)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/22. Primary HQ card: `t_c9c310ac`.

The subsequent [private history/detail/saved edit outcome](BREW_HISTORY.md)
(Refs #25, primary card `t_1befe331`) supersedes historical recent20-only Journal
and unavailable-detail/recipe-edit limits below. Journal uses bounded pages and
is current on valid UUID detail as well as tasting routes. Beans and the shared
dynamic server gate/AccountSession/auth transport remain unchanged.

## Delivered boundary

The dynamic `/app` layout reuses the existing authoritative `currentAuthSession`
server check. All destinations are inside the unchanged mounted `AccountSession`
freshness/renewal boundary. The complete header, navigation, greeting and page
content disappear on pending/null/error. No private list request occurs on the
server or before this boundary mounts children. Auth transport, nonrenewing server
checks, cookies, visibility/pageshow refresh and successful-only sign-out are unchanged.
Only the benign display name enters the shell's props.

Ordinary anchor destinations, in order:

- `/app`: Beans, **Your coffee shelf**.
- `/app/journal`: Journal, **Brew, learn, repeat**.
- `/app/gear`: Gear, **Your daily setup**.

The subsequent [manual coffee entry](COFFEE_UI.md) outcome (Refs #67, primary
card `t_86aa7ea4`) adds ordinary `/app/coffees/new` entry from Beans inside this
same boundary. Beans is current on exactly `/app` and `/app/coffees/new`.
Confirmed creation returns to this real shelf; no coffee Details route is implied.

The brand returns to `/app`; each destination has one H1 and the shared shell has
one main landmark. The focus-visible skip link targets that main. Current navigation
uses shared `NavigationLink` semantics, weight and bottom border, not color alone.
The 430px phone-first column remains usable on desktop. The bottom navigation is
an in-flow footer (deliberately not a fixed overlay) so it cannot obscure rows or
focus at short heights; its padding includes the safe-area inset.

The subsequent [new brew flow](BREW_UI.md) (Refs #23, primary card `t_97784282`)
replaces the disabled Record a brew with the real primary `/app/brews/new` anchor.
Add coffee is secondary. Journal is current at exactly this new route; all Beans
rules remain unchanged. Gear explicitly says saved equipment is not implemented.
No scan, detail, edit or Brew again controls are shipped. Full history remains #25.
Prior reference-only
OCR/enrichment/community/platform discrepancies are not resolved by this slice.

## Read-only recent data

The subsequent [optional sensory and saved tasting](SENSORY_UI.md) outcome
(Refs #24, primary card `t_ba3a6991`) adds real Edit tasting anchors to validated
recent Journal rows. Journal is also current on exactly a valid UUID tasting
route. This narrow assessment editor is not full history/detail/recipe editing;
the recent20 limit and account boundary remain unchanged, and #25 remains open.

`@cupmemo/contracts` is a dist-only browser-safe web dependency. Standalone web
`dev`, `build` and `typecheck` prepare contracts and UI before their consumers.
Beans requests `/api/v1/coffees?limit=20&offset=0`; Journal requests
`/api/v1/brews?limit=20&offset=0`. Requests use GET, credentials include, no-store,
redirect error and a three-second AbortController deadline covering the body.
Responses use the published list schemas and additionally require the requested
20/0 page and at most 20 rows. No persistence package enters browser code.

Each mounted request owns its cancellation and active-result guard. Timeout,
unmount, retry and destination changes cannot restore stale rows even if an
upstream completion ignores abort. The client clears data on error/loading/401;
401 uses fixed sign-in replacement and refresh. Other failures are generic visible
retry states, never empty or raw diagnostics. Only validated empty responses produce
No coffees yet / No brews yet. Lists describe recent records, not total counts;
hasMore explicitly explains the most recent 20 limit. Coffee metadata is only
shown when present. Journal displays the independent overall /100 score, including
0.00/100, and local date/time from the actual saved UTC timestamp. No inferred
sensory calculations, coffee N+1, polling, mutations or private global cache/storage.

## Verification commands

With NODE_ENV unset, from an artifact-free task-owned tree:

```
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

Standalone web dev/build must also be exercised with owned contracts/UI artifacts
removed, including an actual dev HTTP response. Do not remove another checkout's
outputs or overwrite prior evidence.

Provision a new labeled task-only PostgreSQL 17.6 on a verified fixed loopback
port. Keep strong environment configuration outside Git, mode0600. Verify exact
container/volume/labels/mount/port, authenticated role/database/version and public
search_path; source that private environment in EACH invocation, with NODE_ENV unset:

```
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:migrate)
(. /private/task/fixture.env; corepack pnpm db:status)
(. /private/task/fixture.env; corepack pnpm auth:test:integration)
# Inspect the fresh output path before running:
(. /private/task/fixture.env; corepack pnpm auth:test:e2e --output=test-results/fresh-owned-run)
```

The existing browser harness preserves all nine real auth/security/renewal/outage
flows; only obsolete Welcome H1 selectors change to the Beans H1. Added shell tests
use the real production-built Next, owned Fastify and real auth/database/API writes,
including two users, 21 coffees and brews, reload, deep links, back/forward,
keyboard/skip, actual revoked-session collection401 and owned API stop/restart.
Explicit collection-only controlled fault simulations cover pending/500/malformed/
stalled retry. They never mock successful domain/ownership/auth responses. Screenshots
now use `testInfo.outputPath`, so a fresh output directory preserves earlier runs.
The responsive rendered test captures light/dark at 320/360/390/430/1280, actual
long-copy/zero-score states and computed-color contrast. CSS200% small-height stress
is explicitly labeled; it is not proof of native browser zoom or physical-device/
screen-reader checks. Independent rendered visual review remains mandatory.

Preserve the exact-head loopback preview and fixture until owner acceptance. Keep
fixture credentials only in separate private0600 files, never evidence attachments,
PR text or board metadata. Technical -> visual -> owner review stays on this card;
implementation tests are not self-approval or production deployment authority.
