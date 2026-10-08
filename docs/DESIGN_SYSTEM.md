# CupMemo Design System

## Reference implementation

The MVP reference package under `design-reference/` is the concrete visual and interaction baseline for the first release.

The visual-reviewer and UI implementer should inspect `prototype.html` directly rather than interpreting this document in isolation.

This design system explains the principles behind the reference. It should be used to keep new states and components consistent with the prototype, not to redesign the prototype into a different theme.

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

## Fidelity rule

For MVP screens already represented in `prototype.html`:
- preserve the overall information hierarchy
- preserve the intended navigation/flow
- preserve the interaction model
- preserve the Clean Studio visual character

Implementation may improve responsiveness, accessibility, validation, loading/error states, and component quality without needlessly changing the approved product design.

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
- fidelity to the approved MVP reference
- overflow
- scrolling
- touch target size
- form usability
- spacing
- hierarchy
- keyboard accessibility
- empty/error states

Phone experience is the priority.

## Implemented shared foundation (Refs #21)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/21. Primary HQ card: `t_ef89d865`.
This foundation styles the existing authentication/account states; it does not implement
the future shell, brew screens, theme settings, OCR or community flows. The effective
final `#bloom-coffee` Clean Studio overrides in the prototype are the palette/type
reference, not its earlier beige/green/serif rules or outer preview wrapper.

### Package API and native composition

Import `Button`, `Input`, `Card`, `Navigation`, `NavigationLink` from `@cupmemo/ui`;
import `@cupmemo/ui/styles.css` once at the application stylesheet boundary. JavaScript
and TypeScript declarations resolve through the built `dist` package, not a source alias.
The package has React 19.2.4-compatible peer semantics, no bundled React, auth or server
dependency, no blanket client boundary, and no runtime helper dependency.

- `Button`: native button props/ref/className; `variant="primary"` (default),
  `"secondary"` or `"ghost"`. Defaults to `type="button"`; forms explicitly use
  `type="submit"`. Native disabled behavior; callers own pending text/status.
  Width is intrinsic unless callers supply a layout class.
- `Input`: native input props/ref/className, including controlled/uncontrolled values,
  events, constraints, autocomplete and ARIA. Callers own labels, validity state,
  descriptions and visible error text; the component never disables native validation.
- `Card`: native section props/ref/className. Associate a caller-owned heading with
  `aria-labelledby`; use only for meaningful grouping.
- `Navigation`: native nav props/ref/className. Supply `aria-label` or `aria-labelledby`.
- `NavigationLink`: native anchor props/ref/className, required `href`, optional
  `current` boolean sets `aria-current="page"` only when true. No tabs, invented routes,
  disabled-link behavior or nested controls. Current links have a bottom indicator and
  stronger weight as well as surface color. Destinations remain caller-owned.

React 19 ref-as-prop forwarding keeps stateless components server-compatible while
client consumers can pass their real callbacks. Existing auth forms use Button/Input,
and auth/unavailable pages use Card, without changing auth policy or copy. Legacy
account/signout class aliases share the same component styles rather than a second palette.

### Semantic appearance tokens

`packages/ui/src/styles.css` is the single color source. Default `color-scheme: light dark`
follows the browser preference via `light-dark()`. Optional root `data-theme="light"`
or `"dark"` overrides appearance for embedding/testing. There is no theme UI or persistence.
Web aliases and Tailwind 4 `@theme inline` map to these tokens, never duplicate values.

| `--cm-` suffix | Light | Dark |
| --- | --- | --- |
| background | #F5F7FA | #181D24 |
| surface | #FFFFFF | #252C35 |
| surface-secondary | #EAF0FE | #303E59 |
| text-primary | #202632 | #EDF1F8 |
| text-secondary | #666F7D | #AAB4C3 |
| border (decorative) | #E0E5EC | #414B58 |
| input-border (interactive) | #7A8494 | #8793A5 |
| accent | #365FC9 | #9FB7FF |
| accent-foreground | #FFFFFF | #182449 |
| accent-hover | #294DA8 | #B9CAFF |
| danger | #A33232 | #FFB4B4 |
| success | #23633F | #94DFB5 |
| focus-ring | accent | accent |

Normal text requires 4.5:1, large text 3:1, active control boundaries/focus 3:1
against adjacent surfaces. Decorative card borders and disabled controls are exempt,
not evidence that faint decorative borders are valid input boundaries. Rendered-color
numeric evidence is required in the exact-candidate implementation/review report.

### Type and geometry scales

System sans stack: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif.
No font request. Numeric inputs use tabular numerals.

| Type suffix | rem (px at 16px root) | Role |
| --- | --- | --- |
| type-caption | .75 (12) | Eyebrows/captions |
| type-label | .875 (14) | Labels/hints/error copy |
| type-body | 1 (16) | Body and inputs/buttons/links |
| type-title | 1.25 (20) | Brand/section titles |
| type-heading | 1.75 (28) | Narrow-screen heading |
| type-display | 2 (32) | Main heading |

`line-body=1.5`, `line-heading=1.2`; `weight-normal=400`, `weight-medium=500`,
`weight-strong=600`. `space-1/2/3/4/5/6/8/10/12` = 4/8/12/16/20/24/32/40/48px
in rem. `radius-sm/md/lg/xl` = 4/8/12/16px in rem; `border-width=1px`.
Cards have no shadow/gradient. `control-height=3rem` (48px at normal root),
and controls retain at least 44px targets; input base text is 16px.

### Interaction and responsive states

Focus-visible uses a 3px accent outline with 3px offset. Primary hover has a separate
contrast-safe color; secondary/ghost hover uses the secondary surface. Pressed buttons
add an underline. Disabled controls have native semantics, reduced opacity, a dashed
boundary and not-allowed cursor; no fake busy behavior. `aria-invalid="true"` inputs
have danger color plus a thicker leading boundary; callers must provide visible error
copy/descriptions. Current nav has a bottom indicator plus stronger weight. Components
wrap long copy with min-width zero. No animations/transitions are introduced, so reduced
motion preferences are respected without a redundant animation override.

Review real auth at 320/360/390/430/1280px, light/dark, keyboard and 200% zoom. Use a
task-only real React fixture for nav and variants absent from auth; it is not an app-shell
or product-flow demonstration. Do not ship a demo route just to exercise components.

### Fresh-artifact commands

Root `corepack pnpm typecheck` builds UI plus the existing contracts/database prerequisites
before strict noEmit consumers. Root `corepack pnpm test` prepares UI before the existing
OpenAPI/test checks. Standalone `corepack pnpm --filter @cupmemo/web dev` and
`corepack pnpm --filter @cupmemo/web build` prepare UI themselves, even with no UI dist.
Root build remains workspace dependency-ordered; neither source aliases nor cached dist
are accepted as fresh CI evidence. Run the unchanged CI order from an artifact-free
exact-tree checkout with NODE_ENV unset and real auth integration/E2E per AUTH_FRONTEND.
