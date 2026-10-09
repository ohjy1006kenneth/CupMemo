# Private brew history, detail and saved edits (Refs #25)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/25.
Primary HQ card: `t_1befe331` (tenant `cupmemo`).
Owner contract: https://github.com/ohjy1006kenneth/CupMemo/issues/25#issuecomment-6076992250.

## Paged Journal

Journal retains **Brew, learn, repeat**, within the unchanged dynamic app gate and
mounted AccountSession boundary. One page at a time requests the existing private
GET `/api/v1/brews?limit=20&offset=N`; N is a multiple of20 in0..100000. Previous
and Next use actual hasMore and bounds, never totals, a full-history append or a
coffee N+1. Ordering remains the API's brewedAt DESC/id DESC. Offset pages may
shift with concurrent edits. Reentry begins at0; no private state is persisted.

Old rows clear synchronously before page/retry requests. Exact200, published list
schema, requested metadata, at most20 records and unique IDs are required. Errors
are not empty results. Initial empty history offers a real Record a brew anchor;
a later empty page says No brews on this page and retains Previous. Beans stays
recent20 and unchanged. Real rows show equipment/notation, local date, temperature,
derived ratio, duration including drawdown, independent overall /100 and primary
optional qualities /10. Not rated means null, distinct from deliberate zero.
Ordinary uniquely named View brew and existing Edit tasting anchors have no nested
controls or invented labels, stats, Brew again or delete action.

## Bound detail

`/app/brews/[id]` awaits Next params and validates the published UUID before lookup.
Invalid/foreign/missing resources show generic unavailable without reflecting input.
One H1 Your brew appears inside the shell's one main. Client private state is keyed
by ID; GET200 must validate and match it exactly. A separately bound single coffee
GET supplies the real name/roaster. Coffee failure retains validated recipe/tasting
and offers its own Retry;401 from either lookup hides everything and replaces
fixed sign-in plus refresh. No cache, invented join or global private data store.

Recipe uses actual dose/water/Celsius, model-specific notation, saved date/time,
derived ratio, total duration/drawdown and incremental ordered pours with derived
cumulative targets. Tasting displays actual mode, independent overall /100, all
eight nullable qualities /10 even if retained in quick mode, custom tags and notes.
Missing qualities/notes are calm absence, not error or zero. Edit brew goes to the
existing tasting route; Return to journal is fixed.

## One saved recipe and assessment draft

Existing `/app/brews/[id]/tasting` starts Tasting with Edit your tasting; Recipe
shows Edit your brew. Native pressed Recipe/Tasting buttons switch only local view.
One immutable original and one draft preserve actual recipe, pours, assessment,
mode, tags, notes and invalid temporary text across panels. RecipeEditor and
QuickTastingEditor are reused; new-brew Continue and POST policies are unchanged.
Either Save changes validates and saves changed fields from BOTH panels. Invalid
hidden recipe switches/focuses Recipe; hidden qualities expand/focus after mount.
All existing calendar/DST, grams, seconds, chronological pour, exact sum and
drawdown invariants remain authoritative; no silent repair or clamping.

Full shared-schema normalization precedes changed-only PATCH. Response positions
are projected away; supplied pours replace the complete schedule only when changed.
Unchanged local datetime text preserves exact original UTC including milliseconds
and a later DST-overlap occurrence. Deliberate changed text uses the existing native
earlier-overlap localToUTC policy. Normalized no-op performs no request. A sole
93->94 temperature edit supplies only waterTemperatureC, preserving unrelated
concurrent assessment changes. Null clears only explicitly changed nullable fields;
zero is real. IDs, coffeeId, ownership, server timestamps and ratio never enter PATCH.

Success requires nonredirected200, response schema, original id/coffeeId/createdAt
binding and equality of every supplied normalized field. Omitted concurrent fields
may differ legitimately. There is no ETag or exactly-once promise: same-field last
accepted write remains the existing API semantics. Success clears draft/unload
protection before fixed Journal replace+refresh and its real GET; reopened detail
reads fresh values. It does not create a second brew.

## Private lifecycle and deliberate departure

All new/changed reads and PATCH use same-origin credentials include, no-store,
redirect error and a finite3s AbortController deadline covering body parsing.
Generation/unmount guards invalidate late abort-ignoring results. The unchanged
account boundary must permit children before any private request.

One synchronous write guard suppresses doubleclick/Enter. Pending recipe, tasting,
mode and panel controls are disabled/read-only, except deliberate Cancel.401 clears
and signs in;404 terminally hides without edit retry.400/403/413/415 decline and retain
correction. Network/deadline/redirect/unexpected/5xx/malformed/mismatched200 are
uncertain: may have applied, retain mounted draft, Check journal, permanently lock
writes even after edits. No automatic reconciliation/replay; leave/reopen fresh GET.

Pristine normalized drafts have no warning. Changed/invalid/pending/uncertain drafts
have native beforeunload and explicit Cancel confirmation. Refusal retains both
panels; acceptance discards without writing and returns fixed Journal. Leaving
cannot roll back a possible server update. No SPA history trap or offline/crash
persistence guarantee is introduced.

## Verification and gates

Pure/mounted history/detail/saved tests supplement the existing unit suite. The
registered history browser helper shares the existing ONE owned API/PG harness;
all prior59 flows remain, apart from the explicitly superseded recent20 assertion.
Happy/domain/auth/ownership responses remain real; simulated faults are labeled.
Run frozen install, format:check, lint, typecheck, test, build and git diff --check
in unchanged CI order with NODE_ENV unset from an artifact-free exact tree. Source
the private task-owned PG17.6 env in EACH integration invocation; migrations twice,
status3/3, auth/coffee/brew integration and auth:test:e2e with a fresh output path.
Original logs/screenshots and exact-head preview/fixture are retained for review.

Independent exact-head technical review emphasizes authenticated saved writes,
merged invariants/delta, timestamp precision, concurrent omission, privacy/IDOR and
request lifetime. It routes the SAME card to independent actual rendered visual
review, then owner acceptance. Implementation tests are not reviewer PASS. Untested
physical-device/screen-reader checks remain unverified. Only owner integrates and
finalizes. No API/schema/auth/OpenAPI, Gear, Brew again/delete, PWA or deployment
changes are authorized by this outcome.
