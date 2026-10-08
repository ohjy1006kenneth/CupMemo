# Manual coffee entry (Refs #67)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/67.
Primary HQ card: `t_86aa7ea4` (tenant `cupmemo`).

Beans has one ordinary **Add coffee** anchor to `/app/coffees/new`, available with
an empty or populated shelf. This route stays inside the existing dynamic `/app`
server gate and mounted AccountSession boundary. Beans is current on precisely
`/app` and `/app/coffees/new`; Journal/Gear semantics and auth policy are unchanged.
The shell provides the only main landmark. The page provides **Add a coffee** and
an initially empty, single-column manual form using shared Input/Button/tokens.
Record a brew remains disabled; no scan, invented metadata, source badge, detail,
edit/delete, inventory, recipe, tasting, enrichment or community flow is added.

## Input and validation

Reference order is Roaster, Coffee name, Country, Region, Producer, Farm / station,
Variety, Process, Elevation, Roast date, then Roaster tasting notes. Only the first
two are required. The published browser-safe coffeeCreateSchema validates and
normalizes the explicit editable payload before any write. Required strings trim
to nonblank, at most 200 JavaScript code units; optional text trims to null when
blank and is bounded at 500. Elevation remains text, including ranges. Blank native
date input becomes null; shared calendar validation imposes no past-only rule.
Notes use one descriptor per line, ignore blank lines, preserve commas, trim,
allow at most 32 descriptors of 100 code units each, and reject case-sensitive
post-trim duplicates rather than deduplicating. Native required/maxLength rules,
authored field errors, an alert summary and first-invalid focus are complementary.
Raw values stay available for correction; server bodies/exceptions are not shown.

## Private write lifecycle

Only an explicit submit writes to fixed `/api/v1/coffees` using POST JSON,
credentials include, no-store and redirect error. The actual browser supplies
Origin; existing API CSRF and ownership authorization remain authoritative. A
synchronous request guard suppresses double clicks/Enter; native submit is disabled
and fields are readonly while pending. A three-second AbortController deadline
includes response-body validation. Unmount invalidates and aborts the request;
late results, even if an upstream ignores abort, cannot navigate or restore UI.
No draft/private identity enters browser storage, URL, logs or a shared cache.

Only a nonredirected 201 and published coffeeResponseSchema-valid body confirm a
save. The draft and unload protection clear before fixed `/app` replacement and
refresh; the existing shelf GET provides actual saved rows, never optimistic data.
Render, effects, reload and back do not write. The deliberate destination differs
from the prototype's unimplemented Details screen; no fake Details route is added.

401 clears/hides the entire draft and replaces with fixed sign-in plus refresh.
Existing AccountSession pending/null/error suppression and renewal/sign-out behavior
are unchanged. 400/403/413/415 are explicit declined writes: generic error, retained
values and deliberate corrected submit allowed. Network, deadline, 5xx, unexpected
status, redirected response or malformed 201 are **uncertain**, never success:
“This coffee may have been saved. Check your shelf before adding it again.” The
same draft remains locked against further submit even if edited; a real ordinary
**Check coffee shelf** anchor navigates to `/app`. No automatic retry, backend
idempotency change, name matching, automatic reconciliation or exactly-once claim.

Cancel uses native confirmation only for dirty/pending/uncertain drafts. Declining
keeps values; accepting explicitly discards and returns to the shelf. Pending and
uncertain confirmation explains leaving cannot roll back a possibly committed
write. beforeunload is installed only for dirty/pending/uncertain state, and removed
on unmount/success. Ordinary shell/brand links and full-document reload/back receive
native warnings where the browser supports them; no SPA history trap is introduced.
Drafts are intentionally ephemeral, not crash-proof or guaranteed on mobile.

## Verification and review

Behavioral Vitest exercises mounted fields, normalization/bounds/calendar/duplicate
validation, focus, native validity, real callback/request options, confirmed201-only
save, declined/uncertain retention, no replay, pending readonly, body deadline,
unmount/late completion, 401 and cancel/unload cleanup. The existing production
Next/Fastify/PostgreSQL browser harness preserves all 14 auth/shell tests and adds
real minimal/full optional coffee creation, reload/fresh signin, exact owned row
counts, two users, real session-revoked POST401, native cancel/nav/back warnings and
owned API stop/restart. Coffee POST interception is limited to labeled declined,
500, malformed201 and stalled-late faults; happy/auth/ownership responses are real.
New form captures cover 320/360/390/430/1280px light/dark, keyboard, long optional
values, errors and control dimensions, with numeric rendered contrast attachments.
Only generated fixture users are deleted, by exact IDs selected from exact generated
emails. Screenshots use synthetic identities; no credentials/cookies/auth-state,
traces or video are captured. Native200% zoom, further rendered state/focus/contrast
and independent review remain reviewer gates, not implied by automated screenshots.

With NODE_ENV unset, run the unchanged CI order from fresh owned build outputs:
frozen install, format:check, lint, typecheck, test, build and git diff --check.
Standalone web dev/build must prepare upstream contracts/UI without cached outputs,
including actual dev HTTP. Provision a NEW labeled PostgreSQL17.6 fixture on an
available fixed loopback port with private mode0600 env outside Git; verify exact
container/volume labels, mount, port, authenticated role/database/version and public
search_path. Source that private env in EACH shell invocation for db:migrate twice,
db:status (3/3), auth:test:integration, coffee:test:integration and auth:test:e2e with
a fresh output directory. Retain original logs/artifacts and exact-head production
preview for independent technical -> rendered visual -> owner review on THIS card.
Passing implementation checks does not authorize integration or production deployment.
