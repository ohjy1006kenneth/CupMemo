# CupMemo Design System

## Direction: Clean Studio

CupMemo should feel:
- clean
- calm
- modern
- premium
- spacious
- intentional
- mobile-first

It should be coffee-oriented without relying on rustic coffee-shop clichés.

Avoid:
- excessive gradients
- excessive shadows
- glassmorphism everywhere
- giant rounded cards everywhere
- cartoonish coffee imagery
- brown-on-beige stereotypes
- dense enterprise dashboards
- decorative animation that slows brew logging

Favor:
- strong typography
- generous whitespace
- subtle borders
- restrained radii
- clear hierarchy
- polished forms
- comfortable touch targets
- meaningful empty/loading/error states

## Design tokens

Prefer semantic tokens over arbitrary per-component values.

Suggested semantic groups:

```text
background
surface
surface-secondary
text-primary
text-secondary
border
accent
accent-foreground
danger
success

radius-sm
radius-md
radius-lg

space-1
space-2
space-3
...
```

Do not hard-code a large collection of one-off colors and spacing values.

## shadcn/ui

Use shadcn/ui as a source of accessible primitives, not as the final visual identity.

CupMemo should not look like an untouched default shadcn project.

## Typography

Typography should:
- prioritize legibility on phones
- establish obvious heading/body/label hierarchy
- avoid excessive font weights
- keep numeric brew values easy to scan

Use a limited, coherent type scale.

## Forms

Brew logging is the most important interaction.

Forms should:
- make required vs optional fields clear
- use appropriate mobile input types
- keep labels visible
- provide inline validation where useful
- avoid excessive modal nesting
- preserve entered data when practical
- keep primary actions obvious
- use touch-friendly controls

Optional Sensory Detail must look optional.

## Cards and surfaces

Use cards only when they help group information.

Do not wrap every element in a floating card.

Prefer:
- page-level whitespace
- subtle separators
- simple surfaces
- clear content grouping

## Navigation

Navigation should prioritize:
- recording a brew
- brew history
- essential account/settings access

Do not make MVP navigation feel like a large analytics suite.

## States

Every meaningful component/screen should consider:
- loading
- empty
- error
- disabled
- success
- focus
- hover where relevant
- touch/pressed

## Responsive review

Visual-reviewer should inspect:
- common phone viewport
- wider phone viewport
- desktop viewport

Check:
- overflow
- scrolling
- touch target size
- form usability
- spacing
- hierarchy
- keyboard accessibility
- empty/error states

Phone experience is the priority.
