# CupMemo MVP Flow

This document is the canonical behavioral flow for the MVP.

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

The exact field list can evolve during implementation, but should cover the practical recipe/context needed to make the brew useful later, such as coffee, brew method, dose, water, grind-related information, time, temperature, or other parameters when appropriate.

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
- return the user to a useful post-save state, normally brew detail or history

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
- avoid excessive scrolling where possible
- use appropriate input types
- have comfortable touch targets
- keep primary actions obvious
- avoid accidental data loss

Desktop should remain fully usable.
