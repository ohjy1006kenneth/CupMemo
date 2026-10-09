# Optional Sensory Detail and saved tasting (Refs #24)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/24.
Primary HQ card: `t_ba3a6991` (tenant `cupmemo`).
Owner contract: https://github.com/ohjy1006kenneth/CupMemo/issues/24#issuecomment-6074654889.

## One assessment

The existing new-brew draft and QuickTastingEditor now share explicit quick/sensory
mode, an independent required overall /100, all eight nullable /10 qualities, one
tags array and one notes field. New assessment always starts quick with blank
overall, all qualities null and empty tags/notes, regardless of latest recipe.
The latest brew still supplies recipe only; recipe/calendar/pour rules are unchanged.

Native Quick rating / Sensory Detail buttons expose pressed state in a labeled
group, not incomplete ARIA tabs. Detail is optional, not a professional questionnaire.
Quick shows Acidity, Body, Aftertaste; detail shows Fragrance/Aroma, Flavor,
Aftertaste, Acidity, Body, Balance, Sweetness, Overall Impression in reference order.
Overall Impression /10 never calculates the independent overall /100.
Add rating deliberately selects zero; Clear alone restores null. Active blank,
nonfinite, out-of-range and nonquarter qualities are invalid. Collapse/back retain
all text, including invalid hidden fields; final schema validation checks all eight,
expands hidden errors and focuses their mounted controls. POST retains expanded
values even when mode is collapsed quick. No write occurs on mode/back navigation.
Existing reference chips remain; saved custom valid tags are rendered, preserved
and removable. No generic tag-entry feature is added. Notes trim blank to null.

## Narrow saved entry

Validated recent Journal rows have ordinary uniquely named Edit tasting anchors to
`/app/brews/<UUID>/tasting`. The dynamic app server gate and AccountSession boundary
are unchanged. Journal is current only for Journal, new brew and valid UUID tasting
routes; unknown descendants are not current. Next async params are awaited and
published brewIdSchema validation precedes a private lookup. Invalid/missing/foreign
resources show the same generic unavailable UI, without echoing params.

The coordinator keys private state by route ID. Exact GET200, published response
validation and ID equality initialize one immutable original plus one editable
assessment, with actual read-only brewer/date context. There is no recipe tab,
coffee N+1, full history/detail, pagination, Brew again or recipe editing; #25 remains
open. Journal remains honestly limited to its recent twenty records.

Save changes normalizes the assessment through brewPatchSchema and compares it to
the original, including trimmed notes and lexical tag sets. A normalized no-op
reports No changes to save without any request. PATCH contains only changed
assessment fields, never recipe, pours, brewedAt, coffeeId, IDs or timestamps.
Null clears only supplied values; omitted values preserve concurrent unrelated
changes. The API has no ETag/revision precondition: same-field edits use the last
accepted write, not optimistic concurrency or exactly-once guarantees.

Success requires nonredirected200, valid response, original id/coffeeId/createdAt
binding and equality of every supplied normalized assessment field. Legitimate
concurrent recipe changes do not invalidate the response. Success clears private
draft/unload protection before fixed Journal replace+refresh and its real GET.

## Private lifecycle

New GET/PATCH use same-origin credentials include, no-store and redirect error.
The three-second AbortController deadline covers body parsing and validation.
Mounted/active generation guards invalidate timeout, retry, route change, identity
removal and unmount, even when completion ignores abort. Loading hides prior data;
GET failures have visible Retry, not empty defaults. GET401 clears/hides, replaces
fixed sign-in and refreshes. GET404 is unavailable without an edit retry.

A synchronous guard permits one explicit pending write; inputs are readonly,
buttons disabled and status announced. PATCH401 clears/signs in; PATCH404 terminally
clears to unavailable.400/403/413/415 are declined and retain correction/resubmit.
Other failures (network/deadline/redirect/unexpected/malformed/mismatched200/5xx)
are uncertain: may have applied, Check journal, retained mounted draft, permanent
no-write lock even after edits. No automatic read reconciliation or resend; leave
and reopen deliberately for a fresh authoritative GET. POST policy is unchanged.

Pristine saved assessment has no discard warning. Changed assessment/mode and
pending/uncertain attempts receive native beforeunload and explicit Cancel changes
confirmation. Refusal retains; acceptance discards without writing and returns
Journal. Leaving cannot roll back a possible update. Success/unmount remove
protection. No SPA history trap, persistent private storage/URL draft/logging or
mobile/crash persistence claim is introduced.

## Verification and review

Pure/mounted behavioral checks cover all eight values, shared mode/back, hidden
invalid focus, changed-only/no-op normalization, custom tags, binding, deadlines,
late results, double submit, auth/unavailable/declined/uncertain and unload cleanup.
Original behavioral RED/GREEN logs are preserved separately from diagnostics.

The committed sensory browser helper registers with the existing auth suite's one
owned API/database harness. All thirty-nine previous flows remain. Added tests use
real production Next/Fastify/PostgreSQL for creation, persistence, fresh sign-in,
Journal edits, identity/recipe/count preservation, concurrent recipe updates,
cancel/reload/no replay, two-user404, real revocation/deletion and owned outage.
Fault-only interceptions are labeled; successful auth/domain/ownership responses
are not mocked. A labeled streaming Response fault tests a body-stalled deadline
and late completion without modifying production or replaying a write.

Run the unchanged fresh-artifact frozen install, format:check, lint, typecheck,
test, build and diff checks with NODE_ENV unset. Each real DB invocation sources
the private task environment in the same shell: migrations twice, status3/3,
auth/coffee/brew integration and auth:test:e2e with a fresh owned output path.
Only the new labeled PostgreSQL17.6 fixture may be used; preserve original logs,
screenshots and exact-head production preview for independent review.

Independent exact-head technical review must examine the new authenticated write
surface, binding, changed-only semantics, IDOR/privacy and lifecycle. Technical
PASS routes this same card to actual rendered visual review, then owner acceptance.
Native200% zoom and further visual checks remain explicit independent gates;
implementation screenshots are not self-approval. Only owner integrates/finalizes.
No API/contracts/schema/migration/auth policy, production deployment, full #25,
saved Gear, OCR/enrichment/community/inventory/PWA changes are included.
