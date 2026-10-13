# Development release-candidate dossier (Refs #30)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/30. Primary HQ card:
`t_ae1785b8` (board `hq`, tenant `cupmemo`). The
[owner contract](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6122828381)
and its [bounded B1 revision amendment](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6127233128)
control this documentation-only outcome. Documentation
[PR76](https://github.com/ohjy1006kenneth/CupMemo/pull/76) and its
[current-head checks](https://github.com/ohjy1006kenneth/CupMemo/pull/76/checks)
must match the exact-head verification receipt on that same Issue/card, not a
separate outcome.

## Decision boundary and identity

This dossier supports development RC quality / readiness for deployment
**preparation only**. It is NOT production release approval, an internet-security
clearance or permission to touch HDD storage, DNS or unrelated services.
Development/review is configured and scheduler-ready (`execution_hold=false`);
`deployment_target=null`. Owner release-risk disposition remains **PENDING**.

Product baseline: commit `9d019bed55d8c67ae058e15bab2a4e58cb1c28f1`, tree
`0beef878ab0952b72403c5da901c44cca9c48c44`;
[main quality CI38189021122](https://github.com/ohjy1006kenneth/CupMemo/actions/runs/38189021122)
completed SUCCESS at that head. A docs-only descendant must preserve every
application/package/script/test/infrastructure/CI/reference Git object and the
manifests/lockfile. The previously tested candidate was commit
`e71747522b495e93a51f78420ccf9c4b0fad77c8`, tree
`06bc2ac017892909bf204eaf2dfbad90ee4c342f`; its owner-recovered ledger (attachment275)
records that identity and unchanged product objects. Fresh revision identity,
document SHA256, changed paths, comparisons with BOTH previous candidate and
baseline, checks and CI are recorded in a new external **revision** implementation
receipt on the same card. Retained functional runs below belong to their recorded
original heads, not to the revised enclosing commit. The PR head/CI receipt must
match the new revision identity.
A document cannot embed its own enclosing commit hash without changing that hash:
the external exact-head receipt is authoritative, not an inferred baseline alias.
Any changed candidate invalidates affected review/CI verdicts.

Canonical PRODUCT/MVP_FLOW/ARCHITECTURE and delivered contracts govern this
private web MVP, superseding reference-only OCR/enrichment/community/native-stack
claims. The effective prototype Clean Studio overrides at1632+, recipe1677 and
tasting1683 provide visual/interaction intent, not production storage/security.
Delivered: real email/password auth and SQL ownership, manual coffee prerequisite,
recipe/incremental pours, required independently entered overall /100 in quarters,
optional all8 shared /10 qualities (null is absent, zero is valid), same-ID saved
Recipe/Tasting edits, paged Journal/detail and online-only PWA. No new requirement
for saved Gear, Brew again, coffee Details, analytics, OCR, public sharing or a
native client is introduced. Email verification/reset delivery is not configured.

## Executed gates and evidence interpretation

The tables separate original baseline checks from executions on the **previous
tested candidate e717475**. They are retained receipts, not fresh revised-head
functional executions. The bounded B1 amendment authorizes only this document
correction, fresh `corepack pnpm format:check`, `git diff --check`, tracked-tree
hygiene/evidence validation and exact revised-head PR quality CI. It does NOT
authorize another full browser/integration/visual replay for unchanged product.
A missing, failed or mismatched receipt is **UNVERIFIED/FAILED**, never a retrospective PASS.
Functional PASS does not turn the separate nonzero security audit green.

### Durable evidence locator

Use the [published owner recovery](https://github.com/ohjy1006kenneth/CupMemo/issues/30#issuecomment-6126965761)
and the native attachments of primary HQ card `t_ae1785b8` (board `hq`), not
invented attachment URLs. Original run2763 ended without an implementation
handoff or uploaded archives. These are explicitly OWNER-recovered receipts,
not a reconstructed original coder `IMPLEMENTATION.md`:

- Attachments269–272: `cupmemo30-owner-recovery-497727-part1.zip` through
  `part4.zip`; 273: `cupmemo30-owner-recovery-497727-manifest.json`;
  274: `OWNER-RECOVERY.md`; 275: `OWNER-RECOVERY-LEDGER.json`;
  276: `cupmemo30-owner-recovery-497727-storage-verification.json`.
  Manifest273 locates all751 members by archive/name and exact bytes/SHA256/CRC32;
  verification276 records stored archive/receipt bytes and SHA256 readback.
- Independent review2765: attachments277/278
  `cupmemo30-review-2765-part1.zip` / `part2.zip`; 279
  `cupmemo30-review-2765-manifest.json`; 280 `REVIEW.md`; 281
  `cupmemo30-review-2765-storage-verification.json`. All260 members and stored
  archives were verified. Verdict: **CHANGES_REQUIRED / Blocking B1**, NOT PASS.
  Passing independent checks do not supersede that document finding.

Owner archive paths below use `issue-30-evidence/` unless a browser directory is
specified. Reviewer paths use `issue-30-review-2765/` or its browser directory.
Both sets retain full sanitized logs, reports and original screenshots/error
context. Secrets, database files/private rows, cookies/browser profiles, auth
storage state, traces and video are excluded. Each ZIP is below25MB and has
verified ZIP integrity. No invented test-first RED is claimed; original failures
remain retained unchanged. New revision evidence is separately labeled on the
same card and does not impersonate the missing original handoff.

### Previous tested candidate e717475 / tree06bc2ac (retained)

| Gate / actual command | Previous candidate result | Owner-recovered evidence |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile` | exit0, artifact-free CI-order start, NODE_ENV unset | `quality-1.log`, `final-artifact-clean.json` |
| `corepack pnpm format:check` | exit0 | `quality-2.log` |
| `corepack pnpm lint` | exit0 | `quality-3.log` |
| `corepack pnpm typecheck` | exit0 | `quality-4.log` |
| `corepack pnpm test` | default exit0, 364 tests/33 files | `quality-5.log` |
| `corepack pnpm build` | exit0, production workspace build | `quality-6.log` |
| Pre-migration authenticated fixture identity; `corepack pnpm db:migrate` twice; `corepack pnpm db:status` | all exit0; PostgreSQL17.6, literal public search_path; current3/3 | `final-integration-1.log` through `final-integration-4.log` |
| `corepack pnpm db:test:integration` | exit0, real transaction/query/configuration/shutdown | `final-integration-5.log` |
| `corepack pnpm auth:test:integration` | exit0, real persistence/revocation/origin/cookies | `final-integration-6.log` |
| `corepack pnpm domain:test:integration` | exit0, 105 constraint-rejection controls | `final-integration-7.log` |
| `corepack pnpm coffee:test:integration` | exit0, real CRUD/IDOR/FK/rollback/concurrency/TCP/privacy | `final-integration-8.log` |
| `corepack pnpm brew:test:integration` | exit0, all8 assessments/merged edits/IDOR/rollback/concurrency/TCP | `final-integration-9.log` |
| `corepack pnpm api:openapi:test:integration` | exit0, HTTP/schema/status/header parity | `final-integration-10.log` |
| Manifest-derived root authorization integration | exit0, actual two-user SQL ownership/CSRF/session/log checks | `final-integration-11.log`, `issue-30-tools/authorization.mjs` |
| `corepack pnpm audit --json` | **exit1**, 12 advisories: 6 High/5 moderate/1 low, zero critical | `audit-1.log`, `audit-results.json` |
| Tracked-tree hygiene and `git diff --check` | no bounded findings; exit0; unchanged product | ledger275 `candidate`, `candidate-hygiene.json` |
| PR76 previous-head `quality` CI | SUCCESS at e717475, NOT revised-head CI | [CI38241335516](https://github.com/ohjy1006kenneth/CupMemo/actions/runs/38241335516), ledger275 `ci` |

The eleven real integration phases comprise identity, two migrations, status and
all seven integrations; no skipped checks. Ledger275 and archived command ledgers
record actual invocation, identity, log and exit status.

| Browser execution (separate results, unchanged suite) | Actual result | Durable evidence |
| --- | --- | --- |
| Baseline9d019bed: `corepack pnpm test:e2e:isolated --output=test-results/issue-30-base-2763` | 81/81, exit0; cleanup passed, portsReleased=true | owner archives: `browser-base-1.log`, `issue-30-base-2763/report.json`, `browser.log` |
| FIRST e717475 final: `corepack pnpm test:e2e:isolated --output=test-results/issue-30-final-2763` | **80/81, exit1**; auth.spec.mjs:136 failed; owned cleanup passed, portsReleased=true | owner archives: `browser-1.log`, `issue-30-final-2763/report.json`, `browser.log`, failure screenshot/error context |
| Separate same-head coder confirmation: `corepack pnpm test:e2e:isolated --output=test-results/issue-30-final-confirmation-2763` | 81/81, exit0; all11 phases/3 cleanup phases passed, portsReleased=true | owner archives: `browser-confirmation-1.log`, `issue-30-final-confirmation-2763/report.json`, `browser.log`; ledger275 cleanup bind verification |
| Independent reviewer2765, same e717475: `corepack pnpm test:e2e:isolated --output=test-results/issue-30-review-browser-2765` | 81/81, exit0; own fixture, all11 phases/3 cleanup phases passed, portsReleased=true | reviewer archives277/278: `issue-30-review-browser-2765/report.json`, `browser.log`; `browser-cleanup.json`, REVIEW280 |

The first final failure followed successful signout and second-context reload:
the test expected `/sign-in` but remained at `/app` with generic account-unavailable
UI after the unchanged10s deadline. No private-content disclosure was observed in
that retained unavailable state. Passing confirmation and independent runs neither
diagnose, fix nor waive this **UNPROVED auth-redirect reliability attribution**.
This is separate from historical R1 below, not established host-pressure causation.

Independent reviewer2765 also ran format/lint/typecheck/default tests (364/33),
separate audit exit1 and its own PostgreSQL17.6 identity/migrations twice/status3/3,
real auth/coffee/brew/authorization integrations, all exit0. REVIEW280 and its
manifest279 are authoritative for that bounded scope; no reviewer PASS is implied.

### Original baseline9d019bed / tree0beef878 (retained, not final-head runs)

| Gate / actual command | Baseline result | Original evidence |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile` | exit0, artifact-free CI-order start | `quality-base-1.log`, `base-artifact-clean.json` |
| `corepack pnpm format:check` | exit0 | `quality-base-2.log` |
| `corepack pnpm lint` | exit0 | `quality-base-3.log` |
| `corepack pnpm typecheck` | exit0, strict consumers with built prerequisites | `quality-base-4.log` |
| `corepack pnpm test` | first default exit1: 362/364, two unchanged OpenAPI5000ms deadlines; focused OpenAPI10/10 exit0; second DEFAULT exit0, 364/364 in33 files | `quality-base-5.log`, `base-openapi-focused.log`, `base-test-second-default.log` |
| `corepack pnpm build` | exit0, production workspace build | `base-build.log` |
| `corepack pnpm db:migrate` (twice), `corepack pnpm db:status` | all exit0; current3/3 | `base-integration-2.log` through `base-integration-4.log` |
| `corepack pnpm db:test:integration` | exit0, actual PG transaction/query/configuration/shutdown | `base-integration-5.log` |
| `corepack pnpm auth:test:integration` | exit0, actual Better Auth persistence/revocation/origin/cookie checks | `base-integration-6.log` |
| `corepack pnpm domain:test:integration` | exit0, 105 real constraint-rejection controls | `base-integration-7.log` |
| `corepack pnpm coffee:test:integration` | exit0, real CRUD/IDOR/FK/rollback/concurrency/TCP/privacy | `base-integration-8.log` |
| `corepack pnpm brew:test:integration` | exit0, real all8 assessments/merged edits/IDOR/rollback/concurrency/TCP | `base-integration-9.log` |
| `corepack pnpm api:openapi:test:integration` | exit0, actual HTTP/schema/status/header parity | `base-integration-10.log` |
| Manifest-derived root authorization integration | exit0, actual two-user SQL ownership/CSRF/session/log checks, not script-existence-only | `base-integration-11.log`, task-private `authorization.mjs` |
| `corepack pnpm test:e2e:isolated --output=test-results/issue-30-base-2763` | exit0, all81 passed; all phases/cleanup passed, portsReleased=true | `browser-base-1.log`, `issue-30-base-2763/report.json` and `browser.log` |
| `corepack pnpm audit --json` | **exit1**, 12 advisories: 6 High/5 moderate/1 low, zero critical | `preliminary-2.log` (raw JSON); previous-candidate audit separately recorded above |

The initial default unit failure is not erased by the passing rerun. Host pressure
is a diagnostic possibility, not a proved root cause or a fixed application bug.
No timeout/assertion/retry/worker/source change was made. No full migration-upgrade
or H1 adversarial/visual matrix replay is claimed here.

### Retained independent evidence (not fresh Issue30 execution)

- [Issue27 owner acceptance](https://github.com/ohjy1006kenneth/CupMemo/issues/27)
  / primary `t_28765bf2`: PR74 merged `ed37c9485e3112de75ac362cb077244d7dc33f99`,
  tree `4c89f4d46f3643998bac8fa4a3baf7dcee8954d6`. Safe isolated entrypoint;
  implementer twice, reviewer and merged-tree owner each81 flows. Native archives
  227–238 retain original lifecycle/refusal/interruption and failed-unit evidence.
  This is runner provenance; Issue28 subsequently changed the private API boundary.
- [Issue28 independent code/security acceptance](https://github.com/ohjy1006kenneth/CupMemo/issues/28#issuecomment-6115827373)
  / primary `t_56b2e07e`: PR75 candidate `021661c86a304d954a3552de4de88f71b4fc6a79`
  has the exact baseline tree; merged `9d019bed`. H1 private escape response/log/header
  disclosure fixed and independently verified; unsupported malformed fallbacks
  remain stateless. Native241–246 retain independent source/HTTP/integration/81-flow
  evidence. Owner archive246 `cupmemo-issue28-owner-acceptance-run2725.zip`,
  18368314bytes, SHA256 `bf1debc8093fb0a1855f2924178af6861e4d26cada1315cf6ec01f7e8eba9142`.
  Historical N1 nine advisories were accepted as DEVELOPMENT/REVIEW debt ONLY.
- [Issue29 bounded rendered acceptance](https://github.com/ohjy1006kenneth/CupMemo/issues/29#issuecomment-6122731356)
  / primary `t_8cfd2982`, exact baseline: representative320/360/390/430/1280,
  light/dark/short-height, real390 daily flow, optional qualities, same-ID edits,
  cancellation/paging, keyboard/native200% and rendered contrast. Not universal
  WCAG certification or every-pixel/state coverage. Native247–268 preserve failures,
  original-pixel judgments, diagnostics and cleanup. Owner attachment266
  `cupmemo29-owner-2762-ACCEPTANCE.md`, 12698bytes,
  SHA256 `b31ed0e6394cddf68d45002eb95fcb561b3a06e1f5dfd614e3f695dc34520cd5`.
  The prior preview/fixture is CLOSED; there is no surviving deployed environment.

These bounded product verdicts remain applicable only with proved unchanged
product objects. Review2765 executed the independent81-flow and representative
real auth/SQL ownership/coffee/brew checks required by the original contract.
Under the B1 amendment, fresh revision technical review checks the exact revised
diff/document, evidence integrity, hygiene, unchanged product objects,
format:check/diff checks and revised-head CI. Earlier functional evidence remains
labeled retained on e717475, not newly executed on the revision. No automatic full
browser/integration/visual replay for this documentation-only correction.

## Retained dependency-risk inventory — release disposition PENDING

The original candidate and independent review audits expand historical N1's nine records to **12**, including three
PostCSS records newly reported in this outcome. The two new High records have
been surfaced to the owner on the SAME card. Package pins/lockfile are unchanged;
no upgrades, audit suppression or invented internet-release exemption is made.
All links below are upstream advisory identifiers; prerequisites are reachability
conditions, NOT proof of exploitation or a production-security clearance.

Affected exact dependency paths (audit notation):

- F = `apps__api>fastify` at5.8.5 (runtime).
- P = `apps__web>postcss` at8.5.10 (development CSS/build tooling).
- E = `packages__database>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild` at0.18.20.
- V = `.>vitest>vite>esbuild` at0.27.7.

| GHSA / npm audit ID | Severity; path | Exploitation prerequisite; upstream patched version |
| --- | --- | --- |
| [w2qp-rph6-63g4](https://github.com/advisories/GHSA-w2qp-rph6-63g4) /1158514 | moderate; F | Root primitive body JSON Schema with default coercion; >=5.12.1 |
| [3m5p-2c4r-xxw2](https://github.com/advisories/GHSA-3m5p-2c4r-xxw2) /1158519 | moderate; F | Numeric hop-count trustProxy and direct origin access for forwarded spoofing; >=5.12.1 |
| [4mh8-r7rc-xpvc](https://github.com/advisories/GHSA-4mh8-r7rc-xpvc) /1240639 | moderate; F | HTTP/2 enabled plus a trailer-registering route; >=5.12.5 |
| [667r-xxjv-c9mm](https://github.com/advisories/GHSA-667r-xxjv-c9mm) /1240641 | High; F | Async request JSON Schema validator plus attacker value/error collision; >=5.12.2 |
| [p68q-wchp-6fh7](https://github.com/advisories/GHSA-p68q-wchp-6fh7) /1240642 | High; F | Malformed unsupported-method routing reaches a protected-data not-found handler and bypasses its hook; >=5.12.2 |
| [hwr6-493r-vm6h](https://github.com/advisories/GHSA-hwr6-493r-vm6h) /1240643 | High; F | Boolean false deny-all request schema silently skipped; >=5.12.2 |
| [9q9j-q6p8-xq58](https://github.com/advisories/GHSA-9q9j-q6p8-xq58) /1240644 | High; F | Mixed-case header schema dependencies/nested names used as security controls; >=5.12.2 |
| [67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) /1102341 | moderate; E | esbuild serve running, victim visits malicious site, permissive CORS leaks dev files; >=0.25.0 |
| [g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) /1120680 | low; V | Windows esbuild dev server serving a directory, backslash traversal; >=0.28.1 |
| [6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) /1124252 | **High; P; NEW** | Attacker CSS/sourceMappingURL processed by Node PostCSS with filesystem map loading, leaks local file/error bytes; >=8.5.12 |
| [r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) /1139510 | **High; P; NEW** | Attacker CSS traversal annotation loads local .map and discloses sourcesContent; >=8.5.18 |
| [fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) /1130709 | moderate; P; NEW | Incomplete map fix with from unset allows arbitrary .map path loading; >=8.5.23 |

Current Fastify application uses strict Zod body/query/ID validation and explicit
Origin checks rather than these request-schema features; no numeric trustProxy,
HTTP2/trailers or protected-data fallbacks were found in the source inspected.
The esbuild serve/Windows prerequisites were not exercised by these Linux gates.
PostCSS is wired to the web build via Tailwind; the private journal has no approved
user-CSS upload/theme-processing feature. Trusted build input does not prove that
all dependency/supply-chain/deployment inputs are safe. Reassess before exposing a
server, changing build input trust, adding those features or modifying routing.
Historical development N1 disposition does NOT automatically cover the three new
records. **All12 require an explicit new owner release-risk decision before
Issue30 closure; security audit remains FAILED/nonzero.**

## Reproduce safely

Use Node24 (exercised24.15.0), pinned pnpm10.34.6/Corepack, system Chromium and the
local Docker Unix socket. Work only in an authorized task checkout. Start with
owned build/dependency artifacts absent and NODE_ENV unset. Run sequentially:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm audit --json # retain actual nonzero status; separate security gate
```

For an owner-authorized fresh functional browser gate, unset inherited DATABASE_URL, CUPMEMO_DB_ENV, all three
dedicated DB URLs, CUPMEMO_TEST_DATABASE and auth/application fixture variables.
Never source an integration env for this command. Verify a NEW output path first:

```sh
corepack pnpm test:e2e:isolated --output=test-results/issue-30-final-UNIQUE
```

See [E2E.md](E2E.md): one unchanged suite per worktree, real Next/Fastify/PG17.6,
no implicit .env, no target fallback, unchanged workers1/deadlines/retries/assertions.
Require81 passed + exit0 + all phases/owned cleanup + portsReleased. Responsive
viewports are not physical devices; labeled fault interception is not mocked
happy/auth/ownership success. SIGKILL/power loss can bypass finally: verify exact
owned IDs/labels/mount/ports/process cwd/ancestry before recovery, never prune,
broad-kill, reset/drop a DB or stop a competitor. TIME_WAIT is not a listener leak;
verify actual Node/equivalent SO_REUSEADDR bind/listen after cleanup.

For integrations, provision a DIFFERENT newly labeled task-only PostgreSQL17.6
container/volume on a freshly free fixed loopback port; generate strong private
credentials in an outside-Git0600 file. Verify exact IDs, both labels, mount,
TCP readiness and authenticated database/role/version/literal public search_path
BEFORE migrations. Source your verified private env in EACH SAME invocation:

```sh
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm db:migrate)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm db:migrate)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm db:status)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm db:test:integration)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm auth:test:integration)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm domain:test:integration)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm coffee:test:integration)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm brew:test:integration)
(. "$PRIVATE_FIXTURE_ENV"; corepack pnpm api:openapi:test:integration)
```

Keep development auth semantics (not Better Auth test-mode CSRF bypass). For root
authorization integration, construct `['authorization','test','integration'].join(':')`,
verify the root key invokes the matching API workspace key and API target is
`scripts/authorization-integration.mjs`, then spawn `corepack pnpm` with that
EXACT key, current sourced environment and inherited stdio. Never execute a
redacted placeholder or disable secret protection. Require actual exit0, no skip.
Retain the safely verified fixture through review or provide verified fresh-fixture
reproduction. Never attach private env/credentials or dump full Docker inspect.

## Known limitations and remaining decisions

**New auth-redirect attribution risk (Issue30)**: first e717475 final browser run
failed80/81 at signout/second-context reload; the generic unavailable `/app` state
did not redirect to `/sign-in` within unchanged10s. Separate same-head coder and
independent81/81 successes preserve, not erase, that failure. No observed private
disclosure is not a reliability clearance. Cause remains **UNPROVED**, no product
fix was made, and owner release-risk disposition remains **PENDING**. Retain the
original logs/screenshots/error context listed above. Do not conflate this event
with historical R1, attribute either to host pressure or silently waive either.

Historical **R1** long-lived preview anonymous/read stall remains unattributed,
NOT fixed. Bounded owner/reviewer controls did not reproduce it; subsequent real
outage-to-uncertain-lock-to-authoritative-read recovery passed. The earlier whole
R1 diagnostic remained incomplete after a later contrast locator failure; corrected
contrast was separate. Preserve finite request/process/host timelines if it
recurs and return to owner diagnosis before a bounded fix. Development acceptance
of residual attribution risk is not release acceptance.

Other intentional limitations: online-only/no private offline cache or queue;
ephemeral drafts can be lost on reload/eviction/mobile crash; uncertain writes lock
rather than replay; offset paging can shift concurrently; same-field updates are
last accepted write, not ETag/exactly-once. Optional Sensory Detail remains optional.
These are documented behavior, not authorization to invent features.

Release/deployment checklist (all below **PENDING/UNVERIFIED**, not satisfied by
functional or retained desktop visual PASS):

- [ ] Owner explicitly disposes all12 dependency risks, historical R1 and the NEW
  auth-redirect attribution risk;
  independent exact-head technical review and PR quality CI pass, then owner alone
  integrates/verifies the merged tree and closes [#30](https://github.com/ohjy1006kenneth/CupMemo/issues/30).
- [ ] Earliest incomplete Phase3 [#11](https://github.com/ohjy1006kenneth/CupMemo/issues/11):
  approved HDD mount/path and fail-safe startup guard; absent HDD cannot silently
  create live data on SSD/root. No HDD mutation/unmount/reboot is authorized here.
- [ ] [#31](https://github.com/ohjy1006kenneth/CupMemo/issues/31) runtime/storage/Docker/ports
  audit; [#32](https://github.com/ohjy1006kenneth/CupMemo/issues/32) production Dockerfiles/Compose;
  [#41](https://github.com/ohjy1006kenneth/CupMemo/issues/41) same-origin routing;
  [#42](https://github.com/ohjy1006kenneth/CupMemo/issues/42) safe startup/service management.
- [ ] [#43](https://github.com/ohjy1006kenneth/CupMemo/issues/43) Cloudflare account/domain/tunnel;
  [#44](https://github.com/ohjy1006kenneth/CupMemo/issues/44) cloudflared/secrets;
  [#45](https://github.com/ohjy1006kenneth/CupMemo/issues/45) public hostname/external HTTPS;
  [#46](https://github.com/ohjy1006kenneth/CupMemo/issues/46) operations/troubleshooting.
  Verify actual proxy/CDN/log privacy, secure production cookies and private DB/API
  networking; no current public target or internet exposure approval exists.
- [ ] [#47](https://github.com/ohjy1006kenneth/CupMemo/issues/47) automated dumps/7daily4weekly3monthly retention;
  [#48](https://github.com/ohjy1006kenneth/CupMemo/issues/48) real safe restore;
  [#49](https://github.com/ohjy1006kenneth/CupMemo/issues/49) disaster-recovery verification.
  Backup success requires an actual restored database, not a dump file or fixture migration.
- [ ] Physical Android Chrome/iOS Safari usability and native phone installation on
  approved public HTTPS; actual assistive screen-reader testing. Desktop responsive
  emulation, keyboard checks and historical Linux native PWA installation do not
  certify these gates, universal accessibility or comprehensive penetration/load testing.

Actual Phase4/5/6 Issues are closed and Phase7#27/28/29 accepted; stale milestone
counters/duplicate closures are not readiness proof. Production/storage, public
HTTPS, recovery and physical-device gates remain independent, human-authorized
outcomes. Same-card route: coder -> cupmemo-code-reviewer -> cupmemo owner;
no specialist self-approval, merge, Issue closure or card completion.
