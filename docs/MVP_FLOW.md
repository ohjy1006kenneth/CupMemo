# CupMemo MVP Flow

This document is the canonical behavioral flow for the MVP.

## Prototype reference

CupMemo has a clickable MVP reference package originally distributed as `coffee-mvp-reference.zip`.

When unpacked under `design-reference/`, use:
- `prototype.html` for concrete screen sequence, control placement, and interaction behavior
- `MVP_SPEC.md` for detailed UI requirements
- `FLOW_MAP.md` for navigation and state transitions

This document defines the approved product behavior. The prototype provides the concrete visual/interaction realization of that behavior.

For implementation details not explicitly described below, follow the reference package rather than inventing a different flow.

If the prototype conflicts with a later explicit product decision in this document, stop and surface the conflict instead of silently preserving outdated behavior.

## 1. Entry

Unauthenticated users see authentication entry points.

Supported MVP actions:
- sign up
- sign in

Authenticated users enter the main CupMemo app.

## 2. Home

The home experience should make the primary action obvious:

**Record a brew**

The screen should not become a dense analytics dashboard.

Useful supporting content can include recent brews or a concise empty state.

## 3. Start a brew

The user begins a new brew.

Collect only information needed by the approved brew flow.

The concrete field order, grouping, and interaction pattern should follow the MVP reference package when available.

Do not make every possible coffee variable mandatory.

## 4. Quick evaluation

The user can quickly record an overall impression.

The goal is to finish a daily brew entry with minimal friction.

A user must be able to save the brew without opening Sensory Detail.

## 5. Optional Sensory Detail

The user may optionally expand a deeper sensory section.

Canonical dimensions:

- Acidity
- Body
- Aftertaste

The UI should make the section feel optional rather than like an incomplete requirement.

CupMemo should not present this as a full professional cupping score sheet.

There are no Cup Checks.

## 6. Save brew

On save:

- validate input
- persist the brew to the authenticated user's account
- preserve quick evaluation
- preserve optional Sensory Detail if supplied
- return the user to the post-save state defined by the approved MVP flow/reference

## 7. Brew history

Users can browse their own recorded brews.

History should:
- be easy to scan on a phone
- provide a useful empty state
- make it easy to open a brew
- avoid exposing another user's data

Large analytics are outside MVP.

## 8. Brew detail

A brew detail view should show:
- brew recipe/context
- quick evaluation
- Sensory Detail when present
- edit action

Missing optional sensory data should not look like an error.

## 9. Edit brew

Users can edit their own brew.

Sensory Detail can be:
- added later
- changed later
- absent

Edits must preserve ownership and authorization checks.

## 10. Coffee records

CupMemo should support the coffee records necessary to create meaningful brew entries.

Keep coffee management lightweight during MVP.

Do not turn it into a full inventory or purchasing system.

## Important states

Meaningful screens must account for:
- loading
- empty
- validation error
- API/server error
- unauthenticated session
- unauthorized resource access
- successful save/update

## Mobile behavior

Phone use is the primary design target.

Forms should:
- follow the reference flow where specified
- avoid excessive scrolling where possible
- use appropriate input types
- have comfortable touch targets
- keep primary actions obvious
- avoid accidental data loss

Desktop should remain fully usable.
