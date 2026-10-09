# New brew and quick evaluation (Refs #23)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/23.
Primary HQ card: `t_97784282` (tenant `cupmemo`). The complete owner execution
contract is https://github.com/ohjy1006kenneth/CupMemo/issues/23#issuecomment-6072136615.

## Delivered flow

Beans now has an ordinary primary Record a brew link to `/app/brews/new` and a
secondary Add coffee link. The new route stays inside the unchanged dynamic `/app`
server gate and mounted AccountSession boundary. Journal is current on exactly
`/app/brews/new`; Beans rules and Gear/recent Journal remain unchanged. The shell
provides one main and each mounted phase one H1: Choose a coffee, Make it yours,
How did it taste? No new auth instance, pool, server action or Next business handler.

One ephemeral client draft moves from a real coffee chooser to the compact recipe
editor, then quick evaluation. Selection requests one actual 20-record page with
explicit Next/Previous controls, not an appended/full shelf. Published schemas plus
requested page, count and selected-coffee binding validate all reads. Offset pages
may shift with concurrent changes. Latest-recipe lookup requests `coffeeId`, limit1,
offset0, preserving the API's brewedAt/id ordering. Failure is retryable, never
empty data or a silent starter. Late lookup A cannot initialize selection B.

A real latest brew copies only recipe fields and ordered incremental pours, never
assessment or original brewedAt/IDs/positions. Custom equipment and grinder
notation are preserved through Other text controls. No previous brew instead uses
a clearly labeled editable prototype starter: V60, K-Ultra, setting6.2, dose15g,
water250g, 93°C, total168s, pours50@0/100@45/100@90. This is not saved Gear or a
recommendation. An immutable baseline shows before/after recipe changes, including
equipment/notation/pour schedule; no provenance is persisted. Brew time initializes
to actual local now once when recipe lookup validates.

## Recipe invariants

Text trims to 1–200 code units. Grinder setting stays text, supporting arbitrary
model-specific notation. Known numeric settings alone have steppers (K-Ultra0.1,
C40/Ode1); existing decimal digits are preserved. Changing grinder clears its
setting, never converts units or guesses a default. Numeric inputs remain directly
editable: dose0.5g, water5g, temp1°C, duration5s stepper actions. Authoritative input
limits apply: positive grams <=99999.99 with <=2 decimals, temperature0–100 with
<=2 decimals, integer seconds0–86400. Blank never means zero and invalid input is
retained, not silently clamped. Ratio is derived, not stored.

Native datetime-local includes seconds, is explicitly local, validates calendar
components and local roundtrip before UTC conversion. Impossible calendars and
nonexistent daylight-saving times are refused. Ambiguous repeated local times use
the browser's native earlier occurrence; there is no custom timezone picker or
claim of disambiguation. No past/future bound is invented.

Pours1–32 are positive incremental grams with nondecreasing start seconds (equal
allowed), each <=total duration. Drawdown is distinct from last pour start. Reorder
moves water amounts between the fixed chronological start slots, as in the reference;
it never silently sorts entire objects. Cumulative Scale target is derived display
only: explicit incremental inputs and +/-5g still alter that one increment.
Validated integer hundredths compare pour sum to water. Mismatch is visible and
blocks Continue; Use pour total changes only total water when within bounds.
Add pour uses remaining positive water or explicit5g and a bounded next start,
never silently changes total. Continue validates with the shared brewCreateSchema,
using an internal recipe-only assessment placeholder that never enters draft/POST.

## Quick evaluation and save

Overall /100 starts empty and must be deliberately entered in quarter points.
Zero is valid; no seed, formula or attribute average. From blank, + selects0.25
and - selects0. Optional Acidity, Body, Aftertaste are quality /10 in quarters:
initial Not rated/null, deliberate Add rating selects0, Clear returns null.
Overall remains independent. Eight reference toggle chips start unselected;
notes are optional <=5000, trimmed blank becomes null. Expanded qualities remain
null and mode quick. Sensory Detail has honest future copy, not an active fake link.

Only explicit final native submit POSTs shared-schema-normalized editable data to
fixed `/api/v1/brews`; no owner, ID, child position, ratio or provenance. Every GET
and POST uses same origin, credentials include, no-store, redirect error and a
three-second AbortController deadline INCLUDING body validation. Each request has
active-result/unmount/retry guards, including abort-ignoring completions. Synchronous
write guarding suppresses duplicate clicks/Enter. Pending inputs are readonly and
buttons disabled, with status. Account boundary removal aborts and discards data.
No storage, URL draft, logs of private values, background resend or optimistic row.

Only nonredirected201 with a brewResponseSchema-valid matching coffeeId confirms
save. Draft/unload guard clears before fixed `/app/journal` replacement+refresh;
Journal's real GET displays saved data. This owner-approved incremental destination
differs from the unavailable prototype coffee-detail screen. No Details/Edit/Brew
again affordance is invented. 401 hides/clears all account data and replaces fixed
sign-in.400/403/404/413/415 are explicit declined writes, retaining values for
correction;404 generically says selected coffee unavailable and offers deliberate
reselection.5xx/network/deadline/redirect/unexpected/malformed or mismatched201 are
UNCERTAIN: may have committed, check real Journal. That same draft stays locked
against any subsequent submit even after edits. No idempotency/exactly-once fiction.

Back to recipe retains all draft values; phase navigation never writes or reruns
recipe lookup. Changing coffee or Cancel requires native explicit discard after
initialization. Decline retains values; accepted change clears the entire source,
recipe and assessment. Pending/uncertain warnings explain leaving cannot undo a
possibly committed save. Pristine chooser Cancel needs no confirmation. Native
beforeunload protects initialized/pending/uncertain data, cleans on success/unmount,
and warns ordinary full-document anchors/reload/back where supported. No SPA
history trap or mobile/crash-persistence guarantee. Reload restarts selection, no replay.

## Verification and boundaries

Original behavioral RED logs for entry, pure model, mounted flow, navigation and
native feedback are retained separately from GREEN and later failed-run diagnostics.
Mounted tests cover real components and callbacks, numeric/calendar/DST/pour
invariants, optional null/zero, request deadlines/bodies/late responses, privacy
boundary, declined/uncertain lock, duplicate submit, unload and current navigation.
The existing production Next/Fastify/owned PostgreSQL harness retains all24
previous auth/shell/manual flows (only obsolete disabled-brew expectations changed).
The separate registered brew-flow helper shares that one API owner, not duplicate
fixtures. It covers real manual prerequisite, overall-only/optional quick persistence,
fresh signin/reload, a second new ID/count with latest recipe and unchanged first
brew, sensory recipe-only, page2, two-account privacy/foreign404, real revoked401,
selected-coffee deletion404, native warnings/reload/no replay and owned API outage.
Only explicitly LABELED faults intercept declined400/403,500, malformed/mismatched201
and stalled-late writes. Happy/auth/ownership responses remain real. Fresh output
paths preserve original logs/screenshots; no sleeps, retries or deadline weakening.
Numeric contrast is persisted to actual files, not buffer-only attachments.

From fresh task-owned outputs, NODE_ENV unset: frozen install, format:check, lint,
typecheck, test, build, git diff --check in unchanged CI order. Standalone web dev/build
must prepare missing UI/contracts and respond over actual HTTP. Each DB invocation
sources its separate private0600 environment in the SAME shell: migrations twice,
status3/3, auth/coffee/brew integration and auth:test:e2e with a fresh output directory.
Use only the newly labeled task-owned PostgreSQL17.6 fixture, verified exact container,
volume, loopback endpoint, authenticated database/role/version and public search_path.
Never reuse/reset/drop shared or production fixtures or stop unrelated services.

Exact-head production preview, original sanitized evidence and owned fixture remain
available for independent technical -> actual rendered visual -> owner acceptance
on this SAME card. Implementation screenshots/tests are not self-approval. Native
200% zoom, further rendered states/focus/contrast and visual findings must be
explicitly tested by review; untested checks are UNVERIFIED. No physical-device or
screen-reader claim. No API/auth/schema/migration/OpenAPI changes, deployment,
Sensory expansion#24, full detail/edit/history/Brew again#25, saved Gear, OCR,
enrichment, community, inventory or PWA scope. Only owner integrates/closes/completes.
